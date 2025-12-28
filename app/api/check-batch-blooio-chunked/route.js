import { NextResponse } from 'next/server';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { 
  getFromAppCache, 
  saveToAppCache  // ✅ Only these two
} from '../../../lib/appCache.js';

export const maxDuration = 300;

const CHUNK_SIZE = 250;
const MAX_PROCESSING_TIME = 270000;
const MAX_RETRIES = 3;

// ✅ EXPORTED FUNCTION - Can be called directly from other endpoints
export async function processChunk(fileId, resumeFrom = 0) {
  let connection;
  
  try {
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
      return { success: false, error: 'File not found' };
    }
    
    const file = files[0];
    
    // ✅ ENHANCED LOCK: Check offset to prevent duplicate processing
    if (file.processing_offset > startOffset) {
      console.log(`⚠️ File has moved past this offset: ${file.processing_offset} > ${startOffset}`);
      console.log('   This chunk was already processed, skipping');
      return {
        success: true,
        skipped: true,
        currentOffset: file.processing_offset,
        message: 'Chunk already processed'
      };
    }
    
    if (file.processing_offset < startOffset) {
      console.log(`⚠️ File is behind expected offset: ${file.processing_offset} < ${startOffset}`);
      console.log('   Using current file offset instead');
    }
    
    console.log('✓ Offset verified, proceeding with chunk');
    
    if (!file.processing_state) {
      console.error('No processing_state found in file record');
      return { 
        success: false,
        error: 'File not initialized for chunked processing. Please re-upload the file.' 
      };
    }
    
    let processingState;
    try {
      processingState = JSON.parse(file.processing_state);
    } catch (parseError) {
      console.error('Failed to parse processing_state:', parseError);
      return { 
        success: false,
        error: 'Invalid processing state. Please reinitialize the file.' 
      };
    }
    
    const { validPhones, batchId, fileName, service } = processingState;
    
    if (!validPhones || !Array.isArray(validPhones)) {
      console.error('validPhones not found or not an array');
      return { 
        success: false,
        error: 'Invalid processing state: validPhones missing' 
      };
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
      
      // ✅ AUTO-GENERATE RESULTS FILE
      console.log('🔨 Auto-generating results file...');
      
      const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
      const host = request.headers.get('host') || 'ios.smsapp.co';
      const baseUrl = `${protocol}://${host}`;
      
      fetch(`${baseUrl}/api/generate-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: fileId })
      }).catch(err => {
        console.error('Failed to auto-generate results:', err.message);
      });
      
      return {
        success: true,
        isComplete: true,
        processed: totalRecords,
        total: totalRecords,
        progress: 100,
        message: 'All records processed, generating results file...'
      };
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
    let appCacheHits = 0;
    let dbCacheHits = 0;
    let apiCalls = 0;
    let failedNumbers = [];
    
    console.log('\n=== MULTI-TIER CACHE LOOKUP ===');
    
    const phoneNumbers = chunk.map(p => p.e164);
    
    // ✅ TIER 1: App Memory Cache (fastest, <1ms)
    console.log('🔵 TIER 1: Checking app memory cache...');
    const tier1Start = Date.now();
    const appCached = getBatchFromAppCache(phoneNumbers);
    const tier1Duration = Date.now() - tier1Start;
    
    appCacheHits = Object.keys(appCached).length;
    console.log(`✓ App cache: ${appCacheHits}/${phoneNumbers.length} hits in ${tier1Duration}ms`);
    
    // Log cache stats
    const cacheStats = getAppCacheStats();
    console.log(`   Cache size: ${cacheStats.size.toLocaleString()}/${cacheStats.maxSize.toLocaleString()} (${cacheStats.usagePercent}% full)`);
    
    // Add app cache results to chunk
    Object.entries(appCached).forEach(([phoneNumber, data]) => {
      const phone = chunk.find(p => p.e164 === phoneNumber);
      if (phone) {
        cacheHits++;
        chunkResults.push({
          phone_number: phone.original,
          e164: phone.e164,
          is_ios: data.is_ios,
          supports_imessage: data.supports_imessage,
          supports_sms: data.supports_sms,
          contact_type: data.contact_type,
          contact_id: data.contact_id,
          error: data.error,
          from_cache: true,
          cache_source: 'app-memory',
          cache_age_ms: data.cache_age_ms
        });
      }
    });
    
    // ✅ TIER 2: Database Cache (slower, 10-30ms with indexes)
    const uncachedInApp = phoneNumbers.filter(p => !appCached[p]);
    
    let dbCached = {};
    let tier2Duration = 0;
    
    if (uncachedInApp.length > 0) {
      console.log(`\n🟢 TIER 2: Checking database for ${uncachedInApp.length} phones...`);
      
      const tier2Start = Date.now();
      const placeholders = uncachedInApp.map(() => '?').join(',');
      
      // Use optimized query with covering index
      const [cachedRows] = await connection.execute(
        `SELECT phone_number, is_ios, supports_imessage, supports_sms, 
                contact_type, contact_id, error, last_checked
         FROM phone_checks
         WHERE phone_number IN (${placeholders})
           AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
        uncachedInApp
      );
      
      tier2Duration = Date.now() - tier2Start;
      dbCacheHits = cachedRows.length;
      console.log(`✓ Database: ${dbCacheHits}/${uncachedInApp.length} hits in ${tier2Duration}ms`);
      
      // Add DB results to chunk AND promote to app cache
      const toPromote = [];
      cachedRows.forEach(row => {
        const phone = chunk.find(p => p.e164 === row.phone_number);
        if (phone) {
          cacheHits++;
          
          const result = {
            phone_number: phone.original,
            e164: phone.e164,
            is_ios: row.is_ios,
            supports_imessage: row.supports_imessage,
            supports_sms: row.supports_sms,
            contact_type: row.contact_type,
            contact_id: row.contact_id,
            error: row.error,
            from_cache: true,
            cache_source: 'database',
            cache_age_days: Math.floor((Date.now() - new Date(row.last_checked).getTime()) / (1000 * 60 * 60 * 24))
          };
          
          chunkResults.push(result);
          toPromote.push(result);
          dbCached[row.phone_number] = row;
        }
      });
      
      // Promote to app cache
      if (toPromote.length > 0) {
        console.log(`📤 Promoting ${toPromote.length} entries to app cache...`);
        saveBatchToAppCache(toPromote);
      }
    }
    
    // ✅ TIER 3: API Calls (slowest, rate-limited)
    const phonesToCheck = chunk.filter(phone => 
      !appCached[phone.e164] && !dbCached[phone.e164]
    );
    uncachedPhones.push(...phonesToCheck);
    
    console.log(`\n📊 Cache Performance Summary:`);
    console.log(`   App cache hits: ${appCacheHits} (${tier1Duration}ms) ⚡⚡⚡`);
    console.log(`   DB cache hits: ${dbCacheHits} (${tier2Duration}ms) ⚡`);
    console.log(`   Total cache hits: ${cacheHits}/${phoneNumbers.length} (${((cacheHits/phoneNumbers.length)*100).toFixed(1)}%)`);
    console.log(`   Need API calls: ${uncachedPhones.length}`);
    
// STEP 3: Process uncached phones in PARALLEL BATCHES
if (uncachedPhones.length > 0) {
  console.log(`\n--- STEP 3: Processing ${uncachedPhones.length} uncached phones in parallel batches (4 req/sec) ---`);
  
  const apiStartTime = Date.now();
  let totalApiTime = 0;
  let slowApiCalls = 0;
  let retryCount = 0;
  
  const BATCH_SIZE = 4; // Process 4 phones simultaneously per second
  const MAX_RETRIES = 3;
  
  // Process in batches of 4
  for (let batchStart = 0; batchStart < uncachedPhones.length; batchStart += BATCH_SIZE) {
    // Check timeout
    const elapsedTime = Date.now() - chunkStartTime;
    if (elapsedTime > MAX_PROCESSING_TIME) {
      console.warn(`⚠️ TIMEOUT PROTECTION: Stopping at ${elapsedTime}ms`);
      console.warn(`   Processed ${apiCalls}/${uncachedPhones.length} API calls`);
      break;
    }
    
    const batch = uncachedPhones.slice(batchStart, batchStart + BATCH_SIZE);
    
    // Wait for rate limiter (1 second between batches)
    await blooioRateLimiter.acquireBatch(batch.length);
    
    // Process entire batch in parallel with retries
    const batchPromises = batch.map(async (phone) => {
      let apiSuccess = false;
      let result = null;
      let lastError = null;
      
      for (let retryAttempt = 0; retryAttempt <= MAX_RETRIES; retryAttempt++) {
        try {
          if (retryAttempt > 0) {
            retryCount++;
            const backoffMs = Math.pow(2, retryAttempt - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
          
          const apiCallStart = Date.now();
          result = await checkBlooioSingle(phone.e164);
          const apiCallDuration = Date.now() - apiCallStart;
          
          totalApiTime += apiCallDuration;
          
          if (apiCallDuration > 500) {
            slowApiCalls++;
          }
          
          if (result.error && retryAttempt < MAX_RETRIES) {
            lastError = result.error;
            continue;
          }
          
          apiSuccess = true;
          break;
          
        } catch (error) {
          lastError = error.message;
          
          if (retryAttempt === MAX_RETRIES) {
            console.error(`  ❌ Max retries for ${phone.e164}`);
          }
        }
      }
      
      return { phone, apiSuccess, result, lastError };
    });
    
    // Wait for entire batch to complete
    const batchStartTime = Date.now();
    const batchResults = await Promise.all(batchPromises);
    const batchDuration = Date.now() - batchStartTime;
    
    // Process batch results
    batchResults.forEach(({ phone, apiSuccess, result, lastError }) => {
      if (apiSuccess && result && result.is_ios !== null) {
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
    });
    
    // Log batch performance
    if (batchStart % 40 === 0 || (batchStart + BATCH_SIZE) >= uncachedPhones.length) {
      const processed = batchStart + batch.length;
      const progressPct = ((processed / uncachedPhones.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - apiStartTime) / 1000).toFixed(1);
      const avgBatchTime = (batchDuration / 1000).toFixed(2);
      console.log(`  Progress: ${processed}/${uncachedPhones.length} (${progressPct}%) - ${elapsed}s elapsed - Last batch: ${avgBatchTime}s`);
    }
  }
  
  const apiDuration = ((Date.now() - apiStartTime) / 1000).toFixed(1);
  
  console.log(`\n--- API PERFORMANCE BREAKDOWN ---`);
  console.log(`✓ API processing completed in ${apiDuration}s`);
  console.log(`  Processing mode: Parallel batches of 4`);
  console.log(`  Total API calls: ${apiCalls}`);
  
  if (apiCalls > 0) {
    const avgApiTime = (totalApiTime / apiCalls).toFixed(0);
    const expectedTime = Math.ceil(uncachedPhones.length / 4); // 1 second per batch of 4
    const actualRate = (apiCalls / parseFloat(apiDuration)).toFixed(1);
    
    console.log(`  Average API call time: ${avgApiTime}ms`);
    console.log(`  Slow API calls (>500ms): ${slowApiCalls}`);
    console.log(`  Total retries: ${retryCount}`);
    console.log(`  Expected duration: ~${expectedTime}s (at 4/sec parallel)`);
    console.log(`  Actual duration: ${apiDuration}s`);
    console.log(`  Actual rate: ${actualRate} req/sec`);
    
    if (parseFloat(apiDuration) < 70) {
      console.log(`  ⚡ FAST: Parallel processing working efficiently!`);
    }
  }
  
  if (failedNumbers.length > 0) {
    console.warn(`⚠️ ${failedNumbers.length} numbers failed after retries`);
  }
}
    
    const isPartialChunk = (Date.now() - chunkStartTime) > MAX_PROCESSING_TIME;
    
    console.log(`\n--- STEP 4: Saving results to cache layers ---`);
    
    // Filter results to save (exclude cached and failed)
    const resultsToSave = chunkResults.filter(r => !r.from_cache && !r.error);
    
    if (resultsToSave.length > 0) {
      console.log(`💾 Saving ${resultsToSave.length} new results...`);
      
      // ✅ LAYER 1: Save to app cache (instant)
      saveBatchToAppCache(resultsToSave);
      console.log(`✓ Saved to app cache`);
      
      // ✅ LAYER 2: Save to database (persistent)
      try {
        const saveStart = Date.now();
        
        const values = resultsToSave.map(r => [
          r.e164,
          r.is_ios || false,
          r.supports_imessage || false,
          r.supports_sms || false,
          r.contact_type || null,
          r.contact_id || null,
          r.error || null,
          batchId,
          'blooio',
          1,
          fileId
        ]);
        
        await connection.query(
          `INSERT INTO phone_checks 
          (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, 
           error, batch_id, source, check_count, file_id) 
          VALUES ?
          ON DUPLICATE KEY UPDATE
            is_ios = VALUES(is_ios),
            supports_imessage = VALUES(supports_imessage),
            supports_sms = VALUES(supports_sms),
            contact_type = VALUES(contact_type),
            contact_id = VALUES(contact_id),
            error = VALUES(error),
            last_checked = NOW(),
            check_count = check_count + 1`,
          [values]
        );
        
        const saveDuration = Date.now() - saveStart;
        console.log(`✓ Database saved ${resultsToSave.length} results in ${saveDuration}ms`);
      } catch (saveError) {
        console.error('⚠️ Database save failed:', saveError.message);
        console.error('   Continuing processing - results still in app cache');
      }
    } else {
      console.log('No new results to save (all from cache or failed)');
    }
    
    console.log(`\n--- CHUNK SUMMARY ---`);
    console.log(`Total processed: ${chunkResults.length} phones${isPartialChunk ? ' (PARTIAL DUE TO TIMEOUT)' : ''}`);
    console.log(`Cache hits: ${cacheHits} (instant)`);
    console.log(`API calls: ${apiCalls} (rate limited)`);
    console.log(`Failed: ${failedNumbers.length}`);
    console.log(`Saved to cache: ${resultsToSave.length}`);
    
    // Save chunk results with ON DUPLICATE KEY UPDATE to prevent duplicates
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         chunk_data = VALUES(chunk_data),
         created_at = NOW()`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    console.log(`✓ Chunk data saved to processing_chunks table`);
    
    // ✅ CALCULATE NEW OFFSET AND UPDATE DATABASE
    const newOffset = startOffset + chunkResults.length;
    const progressPct = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    // Update progress in database
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
    
    // ✅ SMART AUTO-TRIGGER: Continue immediately if chunk finished fast
    if (!isComplete) {
      if (isPartialChunk) {
        console.log('⏳ Partial chunk due to timeout - cron will resume from offset', newOffset);
      } else {
        const chunkDuration = parseFloat(((Date.now() - chunkStartTime) / 1000).toFixed(1));
        
        // Only auto-trigger if chunk was fast (< 30 seconds)
        if (chunkDuration < 30) {
          console.log(`\n🚀 Fast chunk (${chunkDuration}s) - processing next chunk immediately (offset ${newOffset})...`);
          
          try {
            // Direct recursive call for fast chunks
            return await processChunk(fileId, newOffset);
          } catch (err) {
            console.error('❌ Recursive call failed:', err.message);
            // Fall through to normal return, cron will pick it up
          }
        } else {
          console.log(`⏰ Chunk took ${chunkDuration}s - letting cron handle next chunk`);
        }
      }
    } else {
      console.log('✅ All chunks complete!');
    }
    
    console.log('=== Chunk Complete ===\n');
    
    // Return data object (not NextResponse)
    return {
      success: true,
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progressPct),
      isComplete: isComplete,
      isPartialChunk: isPartialChunk,
      cacheHits: cacheHits,
      appCacheHits: appCacheHits,
      dbCacheHits: dbCacheHits,
      apiCalls: apiCalls,
      failedCount: failedNumbers.length,
      savedToCache: resultsToSave.length,
      chunkSize: chunkResults.length,
      chunkDuration: ((Date.now() - chunkStartTime) / 1000).toFixed(1),
      cacheHitRate: chunkResults.length > 0 ? parseFloat(((cacheHits / chunkResults.length) * 100).toFixed(1)) : 0,
      message: isComplete 
        ? `✅ All ${totalRecords.toLocaleString()} records processed` 
        : isPartialChunk
          ? `⚠️ Partial chunk processed (timeout protection): ${chunkResults.length} phones, continuing...`
          : `Processed ${chunkResults.length} records, ${(totalRecords - newOffset).toLocaleString()} remaining`
    };
    
  } catch (error) {
    console.error('\n=== ❌ CHUNKED PROCESSING ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('====================================\n');
    
    return {
      success: false,
      error: error.message
    };
  }
}

// POST handler - wraps the exported function for HTTP requests
export async function POST(request) {
  try {
    const { fileId, resumeFrom } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    // Call the exported function
    const result = await processChunk(fileId, resumeFrom);
    
    return NextResponse.json(result, { 
      status: result.success ? 200 : (result.error === 'File not found' ? 404 : 500)
    });
    
  } catch (error) {
    console.error('POST handler error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}