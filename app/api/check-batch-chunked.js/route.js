import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import { checkBulkInBatches, categorizeBulkResults } from '../../../lib/subscriberVerify.js';
import { getSubscriberVerifyCacheBatch, saveSubscriberVerifyCacheBatch } from '../../../lib/phoneCache.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import Papa from 'papaparse';

export const maxDuration = 60; // Maximum Vercel allows

const CHUNK_SIZE = 5000; // Process 5000 records per request
const MAX_PROCESSING_TIME = 50000; // Stop after 50 seconds to avoid timeout

export async function POST(request) {
  let connection;
  
  try {
    const body = await request.json();
    const { fileId, resumeFrom = 0 } = body;
    
    connection = await getConnection();
    
    // Get file metadata
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const fileData = files[0];
    const startTime = Date.now();
    
    // Parse processing state (contains all phone data)
    let processingState;
    if (fileData.processing_state) {
      processingState = JSON.parse(fileData.processing_state);
    } else {
      return NextResponse.json({ 
        error: 'File not initialized. Please upload file first.' 
      }, { status: 400 });
    }
    
    const { validPhones, batchId, fileName } = processingState;
    const totalRecords = validPhones.length;
    const startOffset = resumeFrom;
    const endOffset = Math.min(startOffset + CHUNK_SIZE, totalRecords);
    
    console.log(`Processing records ${startOffset} to ${endOffset} of ${totalRecords}`);
    
    // Update status to processing
    await connection.execute(
      'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
      ['processing', fileId]
    );
    
    // Get chunk to process
    const chunk = validPhones.slice(startOffset, endOffset);
    
    console.log(`Chunk size: ${chunk.length} records`);
    
    // BATCH CACHE LOOKUP - ONE QUERY INSTEAD OF 5000!
    console.log(`Batch checking cache for chunk...`);
    const cacheCheckStart = Date.now();
    
    // Prepare phone numbers for batch lookup
    const formattedPhones = chunk.map(v => v.formatted);
    
    // Batch cache lookup
    const cacheMap = await getSubscriberVerifyCacheBatch(formattedPhones);
    
    const cacheCheckTime = ((Date.now() - cacheCheckStart) / 1000).toFixed(2);
    console.log(`Chunk cache check: ${cacheMap.size} hits out of ${chunk.length} in ${cacheCheckTime}s`);
    
    // Separate cached vs uncached
    const cachedResults = [];
    const uncachedPhones = [];
    const uncachedIndices = [];
    
    for (let i = 0; i < chunk.length; i++) {
      const formattedPhone = chunk[i].formatted;
      const cached = cacheMap.get(formattedPhone);
      
      if (cached) {
        cachedResults.push({ ...cached, chunkIndex: i });
      } else {
        // Remove +1 prefix for SubscriberVerify API
        uncachedPhones.push(formattedPhone.replace(/^\+1/, ''));
        uncachedIndices.push(i);
      }
    }
    
    console.log(`Chunk: ${cachedResults.length} cached, ${uncachedPhones.length} need API`);
    
    // Call API for uncached numbers
    let svBulkResults = [];
    
    if (uncachedPhones.length > 0) {
      console.log(`Calling SubscriberVerify API for ${uncachedPhones.length} numbers...`);
      const apiStart = Date.now();
      
      svBulkResults = await checkBulkInBatches(uncachedPhones);
      
      const apiTime = ((Date.now() - apiStart) / 1000).toFixed(2);
      console.log(`API call completed in ${apiTime}s - ${svBulkResults.length} results`);
      
      // Prepare batch data for cache save
      const cacheDataBatch = [];
      
      for (let i = 0; i < svBulkResults.length; i++) {
        const svResult = svBulkResults[i];
        const chunkIndex = uncachedIndices[i];
        const validPhone = chunk[chunkIndex];
        
        cacheDataBatch.push({
          phone_number: validPhone.formatted,
          action: svResult.action,
          reason: svResult.reason,
          deliverable: svResult.action === 'send',
          carrier: svResult.dipCarrier || svResult.nanpCarrier,
          carrier_type: svResult.dipCarrierType || svResult.nanpType,
          is_mobile: (svResult.dipCarrierType === 'mobile' || svResult.nanpType === 'mobile'),
          litigator: svResult.litigator,
          blacklisted: svResult.blackList,
          clicker: svResult.clicker,
          geo_state: svResult.geoState,
          geo_city: svResult.geoCity,
          timezone: svResult.timezone
        });
      }
      
      // BATCH SAVE TO CACHE - ONE QUERY INSTEAD OF 5000!
      if (cacheDataBatch.length > 0) {
        const cacheSaveStart = Date.now();
        await saveSubscriberVerifyCacheBatch(cacheDataBatch);
        const cacheSaveTime = ((Date.now() - cacheSaveStart) / 1000).toFixed(2);
        console.log(`Cache save completed in ${cacheSaveTime}s for ${cacheDataBatch.length} records`);
      }
    }
    
    // Merge cached and fresh results
    const chunkResults = new Array(chunk.length);
    
    // Fill in cached results
    cachedResults.forEach(cached => {
      chunkResults[cached.chunkIndex] = {
        subscriber: cached.phone_number.replace(/^\+1/, ''),
        action: cached.action,
        reason: cached.reason,
        nanpType: cached.carrier_type,
        nanpCarrier: cached.carrier,
        dipCarrier: cached.carrier,
        dipCarrierType: cached.carrier_type,
        litigator: cached.litigator,
        blackList: cached.blacklisted,
        clicker: cached.clicker,
        geoState: cached.geo_state,
        geoCity: cached.geo_city,
        timezone: cached.timezone,
        from_cache: true
      };
    });
    
    // Fill in fresh API results
    svBulkResults.forEach((result, i) => {
      const chunkIndex = uncachedIndices[i];
      chunkResults[chunkIndex] = {
        ...result,
        from_cache: false
      };
    });
    
    // Save chunk results to temporary storage
    const chunkResultsKey = `chunk_${fileId}_${startOffset}`;
    
    console.log(`Saving chunk results to database...`);
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    // Update progress
    const newOffset = endOffset;
    const progress = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_offset = ?, 
           processing_progress = ?,
           processing_status = ?
       WHERE id = ?`,
      [newOffset, progress, isComplete ? 'finalizing' : 'processing', fileId]
    );
    
    const elapsedTime = Date.now() - startTime;
    console.log(`Chunk processed in ${(elapsedTime / 1000).toFixed(2)}s`);
    
    // If complete, generate final CSV
    if (isComplete) {
      console.log('All chunks processed. Generating final CSV...');
      await generateFinalCSV(fileId, connection, fileName);
      
      await connection.execute(
        'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
        ['completed', fileId]
      );
      
      console.log('Processing complete!');
    }
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progress),
      isComplete: isComplete,
      chunkSize: endOffset - startOffset,
      cacheHits: cachedResults.length,
      apiCalls: uncachedPhones.length,
      elapsedSeconds: (elapsedTime / 1000).toFixed(2)
    });
    
  } catch (error) {
    console.error('Chunked processing error:', error);
    console.error('Error stack:', error.stack);
    
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

async function generateFinalCSV(fileId, connection, fileName) {
  try {
    console.log(`Generating final CSV for file ${fileId}...`);
    
    // Get all chunks ordered by offset
    const [chunks] = await connection.execute(
      'SELECT chunk_offset, chunk_data FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset',
      [fileId]
    );
    
    console.log(`Retrieved ${chunks.length} chunks from database`);
    
    // Merge all results
    const allResults = [];
    chunks.forEach(chunk => {
      const chunkData = JSON.parse(chunk.chunk_data);
      
      chunkData.forEach(result => {
        allResults.push({
          phone: result.subscriber,
          action: result.action || 'unknown',
          reason: result.reason || '',
          carrier: result.dipCarrier || result.nanpCarrier || '',
          carrier_type: result.dipCarrierType || result.nanpType || '',
          is_mobile: result.dipCarrierType === 'mobile' || result.nanpType === 'mobile',
          litigator: result.litigator || false,
          blacklisted: result.blackList || false,
          clicker: result.clicker || false,
          geo_state: result.geoState || '',
          geo_city: result.geoCity || '',
          timezone: result.timezone || '',
          from_cache: result.from_cache ? 'YES' : 'NO',
          checked_at: new Date().toISOString()
        });
      });
    });
    
    console.log(`Merged ${allResults.length} total results`);
    
    // Generate CSV
    const csv = Papa.unparse(allResults);
    console.log(`Generated CSV, size: ${csv.length} bytes`);
    
    // Upload to Blob
    const resultsFileName = `${fileName.replace('.csv', '')}_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(
      Buffer.from(csv), 
      resultsFileName, 
      'results'
    );
    
    console.log(`Results uploaded to: ${resultsBlob.url}`);
    
    // Update file record
    await connection.execute(
      'UPDATE uploaded_files SET results_file_url = ?, results_file_size = ? WHERE id = ?',
      [resultsBlob.url, resultsBlob.size, fileId]
    );
    
    console.log(`Updated file record with results URL`);
    
    // Calculate stats
    const categorized = {
      send: allResults.filter(r => r.action === 'send').length,
      unsubscribe: allResults.filter(r => r.action === 'unsubscribe').length,
      blacklist: allResults.filter(r => r.action === 'blacklist').length,
      error: allResults.filter(r => r.action === 'error').length
    };
    
    // Update stats
    await connection.execute(
      `UPDATE uploaded_files 
       SET sv_send_count = ?,
           sv_unsubscribe_count = ?,
           sv_blacklist_count = ?
       WHERE id = ?`,
      [categorized.send, categorized.unsubscribe, categorized.blacklist, fileId]
    );
    
    console.log(`Updated file stats: send=${categorized.send}, unsubscribe=${categorized.unsubscribe}, blacklist=${categorized.blacklist}`);
    
    // Clean up chunks
    await connection.execute(
      'DELETE FROM processing_chunks WHERE file_id = ?',
      [fileId]
    );
    
    console.log(`Cleaned up processing chunks`);
    console.log(`Final CSV generation complete for file ${fileId}`);
    
  } catch (error) {
    console.error('Error generating final CSV:', error);
    throw error;
  }
}