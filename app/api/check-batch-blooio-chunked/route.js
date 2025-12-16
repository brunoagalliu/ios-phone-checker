import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { getCachedPhoneCheck, savePhoneCheckWithFile } from '../../../lib/db.js';

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
    
    console.log('\n--- STEP 1: Checking cache for all phones (NO rate limiting) ---');
    
    // STEP 1: Check cache for ALL phones first (NO rate limiting)
    for (let i = 0; i < chunk.length; i++) {
      const phone = chunk[i];
      
      // Check if this phone was already checked within last 6 months
      const cached = await getCachedPhoneCheck(phone.e164);
      
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
    
    console.log(`✓ Cache hits: ${cacheHits} (instant)`);
    console.log(`✓ Need API calls: ${uncachedPhones.length}`);
    
    // STEP 2: Process uncached phones with rate limiting
    if (uncachedPhones.length > 0) {
      console.log(`\n--- STEP 2: Processing ${uncachedPhones.length} uncached phones with rate limiting (4/sec) ---`);
      
      const apiStartTime = Date.now();
      
      for (let i = 0; i < uncachedPhones.length; i++) {
        const phone = uncachedPhones[i];
        
        // ✅ Rate limit ONLY for API calls (250ms between calls = 4/sec)
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
            console.log(`  API progress: ${apiCalls}/${uncachedPhones.length} (${((apiCalls/uncachedPhones.length)*100).toFixed(1)}%)`);
          }
          
        } catch (error) {
          console.error(`  Error checking ${phone.e164}:`, error.message);
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
      console.log(`✓ API calls completed in ${apiDuration}s (${apiCalls} calls)`);
    }
    
    console.log(`\n--- CHUNK SUMMARY ---`);
    console.log(`Total processed: ${chunkResults.length} phones`);
    console.log(`Cache hits: ${cacheHits} (instant)`);
    console.log(`API calls: ${apiCalls} (rate limited)`);
    
    // Save chunk results to database
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    console.log(`✓ Chunk data saved to database`);
    
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
    
    console.log(`\n--- PROGRESS ---`);
    console.log(`Processed: ${newOffset}/${totalRecords} (${progressPct}%)`);
    console.log(`Status: ${isComplete ? 'COMPLETE' : 'PROCESSING'}`);
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
      message: isComplete 
        ? 'All records processed successfully' 
        : `Processed ${chunk.length} records, ${totalRecords - newOffset} remaining`
    });
    
  } catch (error) {
    console.error('\n=== CHUNKED PROCESSING ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('================================\n');
    
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}