import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { savePhoneCheckWithFile } from '../../../lib/db.js';

export const maxDuration = 300; // 5 minutes for Pro plan

const CHUNK_SIZE = 1000; // Process 1000 records per chunk

export async function POST(request) {
  let connection;
  
  try {
    const { fileId, resumeFrom } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    const startOffset = resumeFrom || 0;
    
    console.log(`\n=== Processing Blooio File ${fileId} from offset ${startOffset} ===`);
    
    connection = await getConnection();
    
    // Get file info with processing state
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    
    // Check if file has processing state
    if (!file.processing_state) {
      console.error('No processing_state found in file record');
      return NextResponse.json({ 
        error: 'File not initialized for chunked processing. Please re-upload the file through the chunked processor.' 
      }, { status: 400 });
    }
    
    // Parse processing state
    let processingState;
    try {
      processingState = JSON.parse(file.processing_state);
    } catch (parseError) {
      console.error('Failed to parse processing_state:', parseError);
      return NextResponse.json({ 
        error: 'Invalid processing state. Please reinitialize the file.' 
      }, { status: 400 });
    }
    
    const { validPhones, batchId, fileName, service } = processingState;
    
    if (!validPhones || !Array.isArray(validPhones)) {
      console.error('validPhones not found or not an array');
      return NextResponse.json({ 
        error: 'Invalid processing state: validPhones missing' 
      }, { status: 400 });
    }
    
    const totalRecords = validPhones.length;
    
    console.log(`File: ${fileName}`);
    console.log(`Total records: ${totalRecords}`);
    console.log(`Starting from: ${startOffset}`);
    console.log(`Chunk size: ${CHUNK_SIZE}`);
    
    // Get chunk of phones to process
    const chunk = validPhones.slice(startOffset, startOffset + CHUNK_SIZE);
    console.log(`Processing chunk: ${chunk.length} phones`);
    
    if (chunk.length === 0) {
      console.log('No more records to process - marking as complete');
      
      await connection.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100
         WHERE id = ?`,
        [fileId]
      );
      
      return NextResponse.json({
        success: true,
        isComplete: true,
        processed: totalRecords,
        total: totalRecords,
        progress: 100,
        message: 'All records processed'
      });
    }
    
    // Mark file as processing
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'processing'
       WHERE id = ?`,
      [fileId]
    );
    
    const chunkResults = [];
    const uncachedPhones = [];
    let cacheHits = 0;
    let apiCalls = 0;
    
    console.log('\n--- STEP 1: Checking cache for all phones (BATCH QUERY) ---');
    
    const cacheStart = Date.now();
    
    // Build list of phone numbers to check
    const phoneNumbers = chunk.map(p => p.e164);
    
    // Batch cache lookup - single query instead of 1000 individual queries!
    const placeholders = phoneNumbers.map(() => '?').join(',');
    const [cachedRows] = await connection.execute(
      `SELECT * FROM phone_checks 
       WHERE phone_number IN (${placeholders})
       AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
      phoneNumbers
    );
    
    const cacheDuration = Date.now() - cacheStart;
    console.log(`✓ Cache batch query completed in ${cacheDuration}ms for ${phoneNumbers.length} phones`);
    
    // Create a Map for O(1) lookup performance
    const cacheMap = new Map();
    cachedRows.forEach(row => {
      cacheMap.set(row.phone_number, {
        ...row,
        from_cache: true,
        cache_age_days: Math.floor((Date.now() - new Date(row.last_checked).getTime()) / (1000 * 60 * 60 * 24))
      });
    });
    
    console.log(`✓ Found ${cacheMap.size} cached records in database`);
    
    // Process chunk using cache map
    for (const phone of chunk) {
      const cached = cacheMap.get(phone.e164);
      
      if (cached) {
        cacheHits++;
        chunkResults.push({
          phone_number: phone.original,
          e164: phone.e164,
          is_ios: cached.is_ios,
          supports_imessage: cached.supports_imessage,
          supports_sms: cached.supports_sms,
          contact_type: cached.contact_type,
          contact_id: cached.contact_id,
          error: cached.error,
          from_cache: true,
          cache_age_days: cached.cache_age_days
        });
      } else {
        // Need to check via API
        uncachedPhones.push(phone);
      }
    }
    
    console.log(`✓ Cache hits: ${cacheHits} phones (instant retrieval)`);
    console.log(`✓ Need API calls: ${uncachedPhones.length} phones`);
    
    // STEP 2: Process uncached phones with rate limiting
    if (uncachedPhones.length > 0) {
      console.log(`\n--- STEP 2: Processing ${uncachedPhones.length} uncached phones with rate limiting (4/sec) ---`);
      
      const apiStartTime = Date.now();
      
      for (let i = 0; i < uncachedPhones.length; i++) {
        const phone = uncachedPhones[i];
        
        // ✅ Rate limit ONLY for API calls (250ms between calls = 4 requests/second)
        await blooioRateLimiter.acquire();
        
        try {
          const result = await checkBlooioSingle(phone.e164);
          apiCalls++;
          
          chunkResults.push({
            phone_number: phone.original,
            e164: phone.e164,
            is_ios: result.is_ios,
            supports_imessage: result.supports_imessage,
            supports_sms: result.supports_sms,
            contact_type: result.contact_type,
            contact_id: result.contact_id,
            error: result.error,
            from_cache: false
          });
          
          // Save to cache for future use
          await savePhoneCheckWithFile({
            phone_number: phone.e164,
            is_ios: result.is_ios,
            supports_imessage: result.supports_imessage,
            supports_sms: result.supports_sms,
            contact_type: result.contact_type,
            contact_id: result.contact_id,
            error: result.error,
            batch_id: batchId,
            source: 'blooio'
          }, fileId);
          
          // Log progress every 50 API calls
          if (apiCalls % 50 === 0) {
            const progressPct = ((apiCalls / uncachedPhones.length) * 100).toFixed(1);
            const elapsed = ((Date.now() - apiStartTime) / 1000).toFixed(1);
            console.log(`  API progress: ${apiCalls}/${uncachedPhones.length} (${progressPct}%) - ${elapsed}s elapsed`);
          }
          
        } catch (error) {
          console.error(`  ❌ Error checking ${phone.e164}:`, error.message);
          chunkResults.push({
            phone_number: phone.original,
            e164: phone.e164,
            is_ios: false,
            supports_imessage: false,
            supports_sms: false,
            contact_type: null,
            contact_id: null,
            error: error.message,
            from_cache: false
          });
        }
      }
      
      const apiDuration = ((Date.now() - apiStartTime) / 1000).toFixed(1);
      const avgPerCall = (apiDuration / apiCalls).toFixed(2);
      console.log(`✓ API calls completed in ${apiDuration}s (${apiCalls} calls, ${avgPerCall}s avg per call)`);
    }
    
    console.log(`\n--- CHUNK SUMMARY ---`);
    console.log(`Total processed: ${chunkResults.length} phones`);
    console.log(`Cache hits: ${cacheHits} (instant)`);
    console.log(`API calls: ${apiCalls} (rate limited)`);
    console.log(`Cache hit rate: ${((cacheHits / chunkResults.length) * 100).toFixed(1)}%`);
    
    // Save chunk results to database
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    console.log(`✓ Chunk data saved to processing_chunks table`);
    
    // Update file progress
    const newOffset = startOffset + chunk.length;
    const progressPct = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_offset = ?,
           processing_progress = ?,
           processing_status = ?
       WHERE id = ?`,
      [
        newOffset,
        progressPct,
        isComplete ? 'completed' : 'processing',
        fileId
      ]
    );
    
    console.log(`\n--- PROGRESS UPDATE ---`);
    console.log(`Processed: ${newOffset.toLocaleString()}/${totalRecords.toLocaleString()} (${progressPct}%)`);
    console.log(`Status: ${isComplete ? '✅ COMPLETE' : '⏳ PROCESSING'}`);
    console.log('=== Chunk Complete ===\n');
    
    return NextResponse.json({
      success: true,
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progressPct),
      isComplete: isComplete,
      cacheHits: cacheHits,
      apiCalls: apiCalls,
      chunkSize: chunk.length,
      cacheHitRate: parseFloat(((cacheHits / chunk.length) * 100).toFixed(1)),
      message: isComplete 
        ? `✅ All ${totalRecords.toLocaleString()} records processed successfully` 
        : `Processed ${chunk.length} records, ${(totalRecords - newOffset).toLocaleString()} remaining`
    });
    
  } catch (error) {
    console.error('\n=== ❌ CHUNKED PROCESSING ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('====================================\n');
    
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}