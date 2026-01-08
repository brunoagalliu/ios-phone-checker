import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ✅ Logging control
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO'; // DEBUG, INFO, WARN, ERROR
const shouldLog = {
  debug: LOG_LEVEL === 'DEBUG',
  info: ['DEBUG', 'INFO'].includes(LOG_LEVEL),
  warn: ['DEBUG', 'INFO', 'WARN'].includes(LOG_LEVEL),
  error: true // Always log errors
};

async function processQueue(request) {
  const startTime = Date.now();
  const MAX_PROCESSING_TIME = 280000; // 280 seconds
  
  if (shouldLog.info) {
    console.log(`[${new Date().toISOString()}] Process queue started`);
  }
  
  const pool = await getConnection();
  
  try {
    const [files] = await pool.execute(
        `SELECT * FROM uploaded_files 
         WHERE processing_status IN ('initialized', 'processing')
         AND processing_offset < processing_total
         ORDER BY upload_date ASC
         LIMIT 1
         FOR UPDATE` // ✅ Lock the row to prevent concurrent processing
      );
    
    if (files.length === 0) {
      console.log('✓ No files to process');
      return NextResponse.json({
        success: true,
        message: 'No files to process',
        processed: 0
      });
    }
    
    const file = files[0];
    if (shouldLog.info) {
        console.log(`Processing file ${file.id}: ${file.processing_offset}/${file.processing_total} (${file.processing_progress}%)`);
      }
    
    await pool.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'processing'
       WHERE id = ?`,
      [file.id]
    );
    // Reset any stuck chunks for this file
await pool.execute(
    `UPDATE processing_chunks 
     SET chunk_status = 'pending'
     WHERE file_id = ?
     AND chunk_status = 'processing'`,
    [file.id]
  );
    
    let totalProcessed = 0;
    let chunksProcessed = 0;
    
    while (Date.now() - startTime < MAX_PROCESSING_TIME) {
        const [chunks] = await pool.execute(
            `SELECT * FROM processing_chunks
             WHERE file_id = ? 
             AND chunk_status IN ('pending', 'failed')
             AND (retry_count < 3 OR retry_count IS NULL)
             ORDER BY 
               CASE chunk_status 
                 WHEN 'pending' THEN 0 
                 WHEN 'failed' THEN 1 
               END,
               chunk_offset ASC
             LIMIT 1`,
            [file.id]
          );
      
      if (chunks.length === 0) {
        console.log('✓ No more chunks to process');
        break;
      }
      
const chunk = chunks[0];
if (shouldLog.debug) {
  console.log(`Chunk ${chunk.id} offset ${chunk.chunk_offset}`);
}
      
      try {
        const phoneData = JSON.parse(chunk.chunk_data);
        // console.log(`   Phones in chunk: ${phoneData.length}`);
        
        const results = [];
        let processedCount = 0;
        let cacheHits = 0;
        let apiCalls = 0;
        
        let lastApiCallTime = 0;
const MIN_API_INTERVAL = 500; 

        // ✅ Sequential processing with proper rate limiting (3 req/sec)
        const DELAY_BETWEEN_API_CALLS = 500; // 350ms = ~2.9 req/sec
        
        for (let i = 0; i < phoneData.length; i++) {
          if (Date.now() - startTime > MAX_PROCESSING_TIME) {
            console.log(`⚠️ Timeout - processed ${processedCount}/${phoneData.length}`);
            break;
          }
          
          const phone = phoneData[i];
          
          // Check cache first (instant, no delay needed)
          const [cachedRows] = await pool.execute(
            `SELECT * FROM blooio_cache WHERE e164 = ? LIMIT 1`,
            [phone.e164]
          );
          
          if (cachedRows.length > 0) {
            const cached = cachedRows[0];
            results.push({
              phone_number: phone.original,
              e164: phone.e164,
              is_ios: cached.is_ios || 0,
              supports_imessage: cached.supports_imessage || 0,
              supports_sms: cached.supports_sms || 0,
              contact_type: cached.contact_type || null,
              error: cached.error || null,
              from_cache: true
            });
            processedCount++;
            cacheHits++;
            continue; // Skip API call delay for cached phones
          }
          







          // Not in cache - call API with retry logic
let success = false;
let lastError = null;
const MAX_RETRIES = 3;

for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
  try {
    // console.log(`🔵 Calling Blooio for ${phone.e164} (attempt ${attempt + 1})`);
    
    const response = await fetch(
      `https://backend.blooio.com/v2/api/contacts/${encodeURIComponent(phone.e164)}/capabilities`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`
        },
        signal: AbortSignal.timeout(15000)
      }
    );
    
    // console.log(`   Response status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`⚠️ Rate limit hit for ${phone.e164} - waiting 5s`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
        console.warn(`⚠️ Server error ${response.status} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      throw new Error(`API ${response.status}`);
    }
    
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`Parse error ${phone.e164}: ${parseError.message}`);
      throw new Error('Failed to parse JSON response');
    }
    
    // Only log errors or suspicious responses
    if (!data || typeof data !== 'object') {
      console.error(`Invalid response for ${phone.e164}`);
      throw new Error('Invalid API response format');
    }
    
    if (data.error) {
      console.error(`API error for ${phone.e164}: ${data.error}`);
      throw new Error(data.message || data.error);
    }
    
    if (!data.capabilities) {
      console.error(`Missing capabilities for ${phone.e164}`);
      throw new Error('Missing capabilities in response');
    }
    
    const capabilities = data.capabilities;
    const supportsIMessage = capabilities.imessage === true;
    const supportsSMS = capabilities.sms === true;
    
    // Only log suspicious results
    if (!supportsIMessage && !supportsSMS && shouldLog.warn) {
      console.warn(`No capabilities: ${phone.e164}`);
    }
    
    const contactType = supportsIMessage ? 'iPhone' : (supportsSMS ? 'Android' : 'Unknown');
    
    console.log(`   📱 Final classification: ${contactType}`);
    
    const result = {
      phone_number: phone.original,
      e164: phone.e164,
      is_ios: supportsIMessage ? 1 : 0,
      supports_imessage: supportsIMessage ? 1 : 0,
      supports_sms: supportsSMS ? 1 : 0,
      contact_type: contactType,
      error: null,
      from_cache: false
    };
    
    // 🚨 Log what we're about to save
    // console.log(`   💾 Result object to save:`, JSON.stringify(result));
    
    results.push(result);
    
    // Only cache successful results
    await pool.execute(
      `INSERT INTO blooio_cache 
       (e164, is_ios, supports_imessage, supports_sms, contact_type)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       is_ios = VALUES(is_ios),
       supports_imessage = VALUES(supports_imessage),
       supports_sms = VALUES(supports_sms),
       contact_type = VALUES(contact_type)`,
      [
        phone.e164,
        supportsIMessage ? 1 : 0,
        supportsIMessage ? 1 : 0,
        supportsSMS ? 1 : 0,
        result.contact_type
      ]
    );
    
    // console.log(`   ✅ Saved to results and cache`);
    
    success = true;
    apiCalls++;
    
    // ✅ STRICT rate limiting: Ensure minimum 500ms between API calls
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;
    const waitTime = Math.max(MIN_API_INTERVAL - timeSinceLastCall, 0);
    
    if (waitTime > 0) {
    //   console.log(`   ⏱️ Rate limit: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastApiCallTime = Date.now();
    
  } catch (error) {
    lastError = error;
    console.error(`❌ Error processing ${phone.e164}:`, error.message);
    
    if ((error.message.includes('timeout') || 
         error.message.includes('ECONNRESET') || 
         error.message.includes('fetch failed')) && 
        attempt < MAX_RETRIES - 1) {
      console.warn(`⚠️ ${error.message} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
    
    break;
  }
}

if (!success) {
  console.error(`❌❌❌ All retries failed for ${phone.e164}: ${lastError?.message}`);
  
  results.push({
    phone_number: phone.original,
    e164: phone.e164,
    is_ios: 0,
    supports_imessage: 0,
    supports_sms: 0,
    contact_type: 'ERROR',
    error: lastError?.message || 'Unknown error',
    from_cache: false
  });
  
  apiCalls++;
}
          
          processedCount++;
          
          if (shouldLog.info && processedCount % 100 === 0) {
            console.log(`${processedCount}/${phoneData.length} phones (Cache: ${cacheHits}, API: ${apiCalls})`);
          }
        }
        
        // Save results
        if (results.length > 0) {

          
          const values = results.map(r => 
            `(${file.id}, ${pool.escape(r.phone_number)}, ${pool.escape(r.e164)}, ${r.is_ios}, ${r.supports_imessage}, ${r.supports_sms}, ${pool.escape(r.contact_type)}, ${pool.escape(r.error)}, ${r.from_cache ? 1 : 0})`
          ).join(',');
          
          await pool.execute(
            `INSERT INTO blooio_results 
             (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, contact_type, error, from_cache)
             VALUES ${values}`
          );
          
          if (shouldLog.debug) {
            console.log(`Saving ${results.length} results`);
          }
        }
        
        // Check if chunk was fully processed
        const fullyProcessed = processedCount === phoneData.length;
        
        if (fullyProcessed) {
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'completed'
             WHERE id = ?`,
            [chunk.id]
          );
          
          
        } else {
            // Partial completion - create new chunk with remaining phones
            const remainingPhones = phoneData.slice(processedCount);
            
            
            // ✅ Check if we've already hit the file total (prevent over-processing)
            const [fileCheck] = await pool.execute(
              `SELECT processing_offset, processing_total FROM uploaded_files WHERE id = ?`,
              [file.id]
            );
            
            // ✅ Only create new chunk if we haven't exceeded the file total
            if (fileCheck[0].processing_offset + remainingPhones.length <= fileCheck[0].processing_total) {
              await pool.execute(
                `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
                 VALUES (?, ?, ?, 'pending')`,
                [
                  file.id,
                  chunk.chunk_offset + processedCount,
                  JSON.stringify(remainingPhones)
                ]
              );
              
              if (shouldLog.info && !fullyProcessed) {
                console.log(`Chunk partial: ${processedCount}/${phoneData.length}, new chunk: ${remainingPhones.length} phones`);
              }            } else {
              console.log(`⚠️ Skipping new chunk - would exceed file total`);
            }
            
            // Mark original chunk as completed
            await pool.execute(
              `UPDATE processing_chunks 
               SET chunk_status = 'completed'
               WHERE id = ?`,
              [chunk.id]
            );
          }
        
        // Update file progress by actual processed count
        await pool.execute(
          `UPDATE uploaded_files 
           SET processing_offset = processing_offset + ?,
               processing_progress = ROUND((processing_offset + ?) / processing_total * 100, 2)
           WHERE id = ?`,
          [processedCount, processedCount, file.id]
        );
        
        // Get updated values
        const [updatedFile] = await pool.execute(
          `SELECT processing_offset, processing_progress FROM uploaded_files WHERE id = ?`,
          [file.id]
        );
        
        totalProcessed += processedCount;
        chunksProcessed++;
        
        // console.log(`✅ Chunk completed: ${updatedFile[0].processing_offset}/${file.processing_total} (${updatedFile[0].processing_progress}%)`);
        // console.log(`   Cache hits: ${cacheHits}, API calls: ${apiCalls}`);
        
        // ✅ Log actual rate achieved
        if (apiCalls > 0) {
          const chunkDuration = (Date.now() - startTime) / 1000;
          const actualRate = apiCalls / chunkDuration;
        //   console.log(`   📊 Actual API rate: ${actualRate.toFixed(2)} req/sec`);
          
          if (actualRate > 2.1) {
            console.warn(`   ⚠️ WARNING: Rate exceeded 2 req/sec! Actual: ${actualRate.toFixed(2)}`);
          }
        }

        
        
    } catch (chunkError) {
        console.error('Chunk processing error:', chunkError);
        
        // Get current retry count
        const [chunkInfo] = await pool.execute(
          `SELECT retry_count FROM processing_chunks WHERE id = ?`,
          [chunk.id]
        );
        
        const retryCount = (chunkInfo[0]?.retry_count || 0) + 1;
        const maxRetries = 3;
        
        if (retryCount < maxRetries) {
          // Mark as failed but allow retry
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'failed',
                 retry_count = ?
             WHERE id = ?`,
            [retryCount, chunk.id]
          );
          
          console.warn(`⚠️ Chunk ${chunk.id} failed (attempt ${retryCount}/${maxRetries}), will retry`);
        } else {
          // Max retries reached, mark as permanently failed
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'failed_permanent',
                 retry_count = ?
             WHERE id = ?`,
            [retryCount, chunk.id]
          );
          
          console.error(`❌ Chunk ${chunk.id} permanently failed after ${maxRetries} attempts`);
        }
        
        await pool.execute(
          `UPDATE uploaded_files 
           SET last_error = ?
           WHERE id = ?`,
          [chunkError.message, file.id]
        );
      }
    }
    
    // Check if file is complete
    const [updatedFile] = await pool.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [file.id]
    );
    
    const currentFile = updatedFile[0];
    
    // ✅ Check if there are any pending chunks left
    const [pendingChunks] = await pool.execute(
      `SELECT COUNT(*) as pending_count 
       FROM processing_chunks 
       WHERE file_id = ? 
       AND chunk_status IN ('pending', 'processing')`,
      [file.id]
    );
    
    // ✅ Only mark complete if offset reached AND no pending chunks
    if (currentFile.processing_offset >= currentFile.processing_total && pendingChunks[0].pending_count === 0) {
    //   console.log(`\n🎉 FILE ${file.id} COMPLETED!`);
      
      // ✅ Run data quality check
      const [qualityCheck] = await pool.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as iphones,
          SUM(CASE WHEN contact_type = 'ERROR' THEN 1 ELSE 0 END) as errors
        FROM blooio_results
        WHERE file_id = ?
      `, [file.id]);
      
      const stats = qualityCheck[0];
      const iphonePct = (stats.iphones / stats.total * 100);
      const errorPct = (stats.errors / stats.total * 100);
      
    //   console.log(`\n📊 Quality Check:`);
    //   console.log(`   Total: ${stats.total}`);
    //   console.log(`   iPhones: ${stats.iphones} (${iphonePct.toFixed(1)}%)`);
    //   console.log(`   Errors: ${stats.errors} (${errorPct.toFixed(1)}%)`);
      
      if (iphonePct < 30) {
        console.warn(`⚠️ WARNING: Only ${iphonePct.toFixed(1)}% iPhones detected - expected 30-50%`);
      }
      
      if (errorPct > 10) {
        console.warn(`⚠️ WARNING: ${errorPct.toFixed(1)}% errors - expected <10%`);
      }
      
      await pool.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100
         WHERE id = ?`,
        [file.id]
      );
    } else if (pendingChunks[0].pending_count > 0) {
      console.log(`\n⚠️ File offset reached total, but ${pendingChunks[0].pending_count} chunks still pending`);
    }
    
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    // console.log(`\n✓ Processed ${totalProcessed} phones in ${chunksProcessed} chunks`);
    // console.log(`✓ Elapsed time: ${elapsedTime}s`);
    
    return NextResponse.json({
      success: true,
      fileId: file.id,
      fileName: file.file_name,
      chunksProcessed: chunksProcessed,
      phonesProcessed: totalProcessed,
      progress: currentFile.processing_progress,
      elapsedTime: `${elapsedTime}s`
    });
    
  } catch (error) {
    console.error('Process queue error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// Export both GET and POST handlers
export async function GET(request) {
  return processQueue(request);
}

export async function POST(request) {
  return processQueue(request);
}