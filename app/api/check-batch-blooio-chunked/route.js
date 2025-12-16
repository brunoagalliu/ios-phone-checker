import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { getCachedPhoneCheck, savePhoneCheckWithFile } from '../../../lib/db.js';

export const maxDuration = 300;

const CHUNK_SIZE = 1000;

export async function POST(request) {
  let connection;
  
  try {
    const { fileId, resumeFrom } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    const startOffset = resumeFrom || 0;
    
    console.log(`\n=== Processing File ${fileId} from offset ${startOffset} ===`);
    
    connection = await getConnection();
    
    // Get file info
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    
    if (!file.processing_state) {
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
    
    const { validPhones, batchId } = processingState;
    const totalRecords = validPhones.length;
    
    console.log(`Total records: ${totalRecords}, Starting from: ${startOffset}`);
    
    // Get chunk
    const chunk = validPhones.slice(startOffset, startOffset + CHUNK_SIZE);
    console.log(`Processing chunk: ${chunk.length} phones`);
    
    if (chunk.length === 0) {
      return NextResponse.json({
        success: true,
        isComplete: true,
        processed: totalRecords,
        total: totalRecords,
        message: 'All records processed'
      });
    }
    
    // Mark as processing
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
    
    console.log('Step 1: Checking cache for all phones...');
    
    // STEP 1: Check cache for ALL phones first (NO rate limiting)
    for (let i = 0; i < chunk.length; i++) {
      const phone = chunk[i];
      
      const cached = await getCachedPhoneCheck(phone.e164);
      
      if (cached) {
        cacheHits++;
        chunkResults.push({
          phone_number: phone.original,
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
    
    console.log(`Cache hits: ${cacheHits}, Need API calls: ${uncachedPhones.length}`);
    
    // STEP 2: Process uncached phones with rate limiting
    if (uncachedPhones.length > 0) {
      console.log(`Step 2: Processing ${uncachedPhones.length} uncached phones with rate limiting...`);
      
      for (const phone of uncachedPhones) {
        // ✅ Rate limit ONLY for API calls
        await blooioRateLimiter.acquire();
        
        try {
          const result = await checkBlooioSingle(phone.e164);
          apiCalls++;
          
          chunkResults.push({
            phone_number: phone.original,
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
          
        } catch (error) {
          console.error(`Error checking ${phone.e164}:`, error);
          chunkResults.push({
            phone_number: phone.original,
            error: error.message,
            from_cache: false
          });
        }
      }
    }
    
    console.log(`Processed: ${chunkResults.length} phones (${cacheHits} cached, ${apiCalls} API calls)`);
    
    // Save chunk results
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    // Update progress
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
    
    console.log(`Progress: ${newOffset}/${totalRecords} (${progressPct}%)`);
    console.log('=== Chunk Complete ===\n');
    
    return NextResponse.json({
      success: true,
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progressPct),
      isComplete: isComplete,
      cacheHits: cacheHits,
      apiCalls: apiCalls,
      chunkSize: chunk.length
    });
    
  } catch (error) {
    console.error('Chunked processing error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}