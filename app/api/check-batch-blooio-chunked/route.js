import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { savePhoneCheckWithFile } from '../../../lib/db.js';

export const maxDuration = 300;

const CHUNK_SIZE = 250; // Reduced from 400 to prevent timeouts
const MAX_PROCESSING_TIME = 270000; // 4.5 minutes - leave 30s buffer
const MAX_RETRIES = 3;

export async function POST(request) {
  let connection;
  
  try {
    const { fileId, resumeFrom } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    const startOffset = resumeFrom || 0;
    const chunkStartTime = Date.now();
    
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
    
    if (!file.processing_state) {
      console.error('No processing_state found in file record');
      return NextResponse.json({ 
        error: 'File not initialized for chunked processing. Please re-upload the file.' 
      }, { status: 400 });
    }
    
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
    let failedNumbers = [];
    
    console.log('\n--- STEP 1: Checking cache for all phones (BATCH QUERY) ---');
    
    const cacheStart = Date.now();
    const phoneNumbers = chunk.map(p => p.e164);
    
    // Batch cache lookup
    const placeholders = phoneNumbers.map(() => '?').join(',');
    const [cachedRows] = await connection.execute(
      `SELECT * FROM phone_checks 
       WHERE phone_number IN (${placeholders})
       AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
      phoneNumbers
    );
    
    const cacheDuration = Date.now() - cacheStart;
    console.log(`✓ Cache batch query completed in ${cacheDuration}ms for ${phoneNumbers.length} phones`);
    
    // Create Map for O(1) lookup
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
        uncachedPhones.push(phone);
      }
    }
    
    console.log(`✓ Cache hits: ${cacheHits} phones (instant retrieval)`);
    console.log(`✓ Need API calls: ${uncachedPhones.length} phones`);
    
    // STEP 2: Process uncached phones with rate limiting AND retry logic
    if (uncachedPhones.length > 0) {
      console.log(`\n--- STEP 2: Processing ${uncachedPhones.length} uncached phones with rate limiting (4/sec) ---`);
      
      const apiStartTime = Date.now();
      
      for (let i = 0; i < uncachedPhones.length; i++) {
        // ✅ Check timeout BEFORE processing each number
        const elapsedTime = Date.now() - chunkStartTime;
        if (elapsedTime > MAX_PROCESSING_TIME) {
          console.warn(`⚠️ TIMEOUT PROTECTION: Stopping at ${elapsedTime}ms`);
          console.warn(`   Processed ${apiCalls}/${uncachedPhones.length} API calls`);
          console.warn(`   Saving partial progress to avoid function timeout`);
          break; // Exit loop, save progress, and trigger next chunk
        }
        
        const phone = uncachedPhones[i];
        
        await blooioRateLimiter.acquire();
        
        // Retry logic for API calls
        let apiSuccess = false;
        let result = null;
        let lastError = null;
        
        for (let retryAttempt = 0; retryAttempt <= MAX_RETRIES; retryAttempt++) {
          try {
            if (retryAttempt > 0) {
              console.log(`  🔄 Retry ${retryAttempt}/${MAX_RETRIES} for ${phone.e164}`);
              const backoffMs = Math.pow(2, retryAttempt - 1) * 1000;
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
            
            result = await checkBlooioSingle(phone.e164);
            
            if (result.error && retryAttempt < MAX_RETRIES) {
              lastError = result.error;
              console.log(`  ⚠️ API returned error: ${result.error}, will retry`);
              continue;
            }
            
            apiSuccess = true;
            apiCalls++;
            break;
            
          } catch (error) {
            lastError = error.message;
            console.error(`  ❌ Attempt ${retryAttempt + 1} failed for ${phone.e164}:`, error.message);
            
            if (retryAttempt === MAX_RETRIES) {
              console.error(`  ❌ Max retries reached for ${phone.e164}, marking as failed`);
            }
          }
        }
        
        if (apiSuccess && result) {
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
          
          try {
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
          } catch (saveError) {
            console.error(`  ⚠️ Failed to save to cache: ${saveError.message}`);
          }
          
        } else {
          failedNumbers.push(phone.e164);
          
          chunkResults.push({
            phone_number: phone.original,
            e164: phone.e164,
            is_ios: false,
            supports_imessage: false,
            supports_sms: false,
            contact_type: null,
            contact_id: null,
            error: `Failed after ${MAX_RETRIES} retries: ${lastError}`,
            from_cache: false
          });
        }
        
        if (apiCalls % 50 === 0 && apiCalls > 0) {
          const progressPct = ((apiCalls / uncachedPhones.length) * 100).toFixed(1);
          const elapsed = ((Date.now() - apiStartTime) / 1000).toFixed(1);
          console.log(`  API progress: ${apiCalls}/${uncachedPhones.length} (${progressPct}%) - ${elapsed}s elapsed`);
        }
      }
      
      const apiDuration = ((Date.now() - apiStartTime) / 1000).toFixed(1);
      console.log(`✓ API processing completed in ${apiDuration}s`);
      
      if (failedNumbers.length > 0) {
        console.warn(`⚠️ ${failedNumbers.length} numbers failed after retries`);
      }
    }
    
    const isPartialChunk = (Date.now() - chunkStartTime) > MAX_PROCESSING_TIME;
    
    console.log(`\n--- CHUNK SUMMARY ---`);
    console.log(`Total processed: ${chunkResults.length} phones${isPartialChunk ? ' (PARTIAL DUE TO TIMEOUT)' : ''}`);
    console.log(`Cache hits: ${cacheHits} (instant)`);
    console.log(`API calls: ${apiCalls} (rate limited)`);
    console.log(`Failed: ${failedNumbers.length}`);
    if (isPartialChunk) {
      console.log(`⚠️ Partial chunk: ${chunkResults.length}/${chunk.length} phones processed before timeout`);
    }
    
    // Save chunk results
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    console.log(`✓ Chunk data saved to processing_chunks table`);
    
    // Update file progress - only count what we actually processed
    const newOffset = startOffset + chunkResults.length;
    const progressPct = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_offset = ?,
           processing_progress = ?,
           processing_status = ?,
           last_error = ?
       WHERE id = ?`,
      [
        newOffset,
        progressPct,
        isComplete ? 'completed' : 'processing',
        failedNumbers.length > 0 ? `${failedNumbers.length} numbers failed` : null,
        fileId
      ]
    );
    
    console.log(`\n--- PROGRESS UPDATE ---`);
    console.log(`Processed: ${newOffset.toLocaleString()}/${totalRecords.toLocaleString()} (${progressPct}%)`);
    console.log(`Status: ${isComplete ? '✅ COMPLETE' : '⏳ PROCESSING'}`);
    
    // ✅ ALWAYS trigger next chunk if not complete (even for partial chunks)
    if (!isComplete) {
      console.log(`\n🔄 Auto-triggering next chunk (offset: ${newOffset})...`);
      
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'https://ios.trackthisclicks.com';
      
      // Don't await - fire and forget
      fetch(`${baseUrl}/api/check-batch-blooio-chunked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId: fileId, 
          resumeFrom: newOffset 
        })
      }).catch(err => console.error('❌ Auto-trigger failed:', err.message));
      
      console.log('✓ Next chunk triggered');
    }
    
    console.log('=== Chunk Complete ===\n');
    
    return NextResponse.json({
      success: true, // ✅ Always true if we saved progress
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progressPct),
      isComplete: isComplete,
      isPartialChunk: isPartialChunk,
      cacheHits: cacheHits,
      apiCalls: apiCalls,
      failedCount: failedNumbers.length,
      chunkSize: chunkResults.length,
      cacheHitRate: chunkResults.length > 0 ? parseFloat(((cacheHits / chunkResults.length) * 100).toFixed(1)) : 0,
      message: isComplete 
        ? `✅ All ${totalRecords.toLocaleString()} records processed` 
        : isPartialChunk
          ? `⚠️ Partial chunk processed (timeout protection): ${chunkResults.length} phones, continuing...`
          : `Processed ${chunkResults.length} records, ${(totalRecords - newOffset).toLocaleString()} remaining`
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