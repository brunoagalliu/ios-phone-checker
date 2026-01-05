import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function processQueue(request) {
  const startTime = Date.now();
  const MAX_PROCESSING_TIME = 280000; // 280 seconds
  
  console.log('\n=== PROCESS QUEUE TRIGGERED ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Method: ${request?.method || 'CRON'}`);
  
  const pool = await getConnection();
  
  try {
    const [files] = await pool.execute(
      `SELECT * FROM uploaded_files 
       WHERE processing_status IN ('initialized', 'processing')
       AND processing_offset < processing_total
       ORDER BY upload_date ASC
       LIMIT 1`
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
    console.log(`\n📄 PROCESSING FILE ${file.id}: ${file.file_name}`);
    console.log(`   Status: ${file.processing_status}`);
    console.log(`   Progress: ${file.processing_offset}/${file.processing_total} (${file.processing_progress}%)`);
    console.log(`   Service: ${file.service}`);
    
    await pool.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'processing'
       WHERE id = ?`,
      [file.id]
    );
    
    let totalProcessed = 0;
    let chunksProcessed = 0;
    
    while (Date.now() - startTime < MAX_PROCESSING_TIME) {
      const [chunks] = await pool.execute(
        `SELECT * FROM processing_chunks
         WHERE file_id = ? 
         AND chunk_status = 'pending'
         ORDER BY chunk_offset ASC
         LIMIT 1`,
        [file.id]
      );
      
      if (chunks.length === 0) {
        console.log('✓ No more chunks to process');
        break;
      }
      
      const chunk = chunks[0];
      console.log(`\n📦 Processing chunk ${chunk.id} (offset: ${chunk.chunk_offset})`);
      
      await pool.execute(
        `UPDATE processing_chunks 
         SET chunk_status = 'processing'
         WHERE id = ?`,
        [chunk.id]
      );
      
      try {
        const phoneData = JSON.parse(chunk.chunk_data);
        console.log(`   Phones in chunk: ${phoneData.length}`);
        
        const results = [];
        let processedCount = 0;
        let cacheHits = 0;
        let apiCalls = 0;
        
        // ✅ Sequential processing with proper rate limiting (3 req/sec)
        const DELAY_BETWEEN_API_CALLS = 350; // 350ms = ~2.9 req/sec
        
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
          const MAX_RETRIES = 3; // ✅ Increased from 2
          
          for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
            try {
              const response = await fetch(
                `https://backend.blooio.com/v1/api/contacts/${encodeURIComponent(phone.e164)}/capabilities`,
                {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`
                  },
                  signal: AbortSignal.timeout(15000) // 15 seconds
                }
              );
              
              if (!response.ok) {
                if (response.status === 429) {
                  console.warn(`⚠️ Rate limit hit for ${phone.e164} - waiting 5s`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  continue; // Retry
                }
                
                // ✅ Retry on server errors (5xx)
                if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
                  console.warn(`⚠️ Server error ${response.status} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  continue; // Retry
                }
                
                throw new Error(`API ${response.status}`);
              }
              
              const data = await response.json();

              // ✅ Temporary debug logging
if (processedCount < 10) {
    console.log(`\n🔍 DEBUG - Phone ${phone.e164}:`);
    console.log('   Raw Response:', JSON.stringify(data, null, 2));
    console.log('   Capabilities:', data.capabilities);
    console.log('   iMessage:', data.capabilities?.imessage);
    console.log('   SMS:', data.capabilities?.sms);
  }
              
              // ✅ Validate response structure
              if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response format');
              }
              
              // ✅ Check for API error responses
              if (data.error) {
                throw new Error(data.message || data.error);
              }
              
              // ✅ Validate capabilities object exists
              if (!data.capabilities) {
                throw new Error('Missing capabilities in response');
              }
              
              const capabilities = data.capabilities;
              const supportsIMessage = capabilities.imessage === true;
              const supportsSMS = capabilities.sms === true;
              
              // ✅ Log suspicious responses
              if (!supportsIMessage && !supportsSMS) {
                console.warn(`⚠️ Phone ${phone.e164} has no capabilities - possible API issue`);
              }
              
              const result = {
                phone_number: phone.original,
                e164: phone.e164,
                is_ios: supportsIMessage ? 1 : 0,
                supports_imessage: supportsIMessage ? 1 : 0,
                supports_sms: supportsSMS ? 1 : 0,
                contact_type: supportsIMessage ? 'iPhone' : (supportsSMS ? 'Android' : 'Unknown'),
                error: null,
                from_cache: false
              };
              
              results.push(result);
              
              // ✅ Only cache successful results (no errors)
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
              
              success = true;
              apiCalls++;
              
              // ✅ Rate limiting: Wait 350ms before next API call
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_API_CALLS));
              
            } catch (error) {
              lastError = error;
              
              // ✅ Retry on timeouts and network errors
              if ((error.message.includes('timeout') || 
                   error.message.includes('ECONNRESET') || 
                   error.message.includes('fetch failed')) && 
                  attempt < MAX_RETRIES - 1) {
                console.warn(`⚠️ ${error.message} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; // Retry
              }
              
              break; // Don't retry on other errors
            }
          }
          
          if (!success) {
            // ✅ Mark as ERROR, don't pretend to know device type
            console.error(`❌ Failed for ${phone.e164}: ${lastError?.message}`);
            
            results.push({
              phone_number: phone.original,
              e164: phone.e164,
              is_ios: 0,
              supports_imessage: 0,
              supports_sms: 0,
              contact_type: 'ERROR', // ✅ Explicit error marker
              error: lastError?.message || 'Unknown error',
              from_cache: false
            });
            
            apiCalls++;
            // ❌ DON'T cache errors!
          }
          
          processedCount++;
          
          // Log progress every 50 phones
          if (processedCount % 50 === 0 || processedCount === phoneData.length) {
            console.log(`   📊 ${processedCount}/${phoneData.length} phones | Cache: ${cacheHits} | API: ${apiCalls}`);
          }
        }
        
        // Save results
        if (results.length > 0) {
          console.log(`--- Saving ${results.length} results ---`);
          
          const values = results.map(r => 
            `(${file.id}, ${pool.escape(r.phone_number)}, ${pool.escape(r.e164)}, ${r.is_ios}, ${r.supports_imessage}, ${r.supports_sms}, ${pool.escape(r.contact_type)}, ${pool.escape(r.error)}, ${r.from_cache ? 1 : 0})`
          ).join(',');
          
          await pool.execute(
            `INSERT INTO blooio_results 
             (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, contact_type, error, from_cache)
             VALUES ${values}`
          );
          
          console.log(`✅ Saved ${results.length} results to database`);
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
          
          console.log(`✅ Chunk ${chunk.id} fully completed (${processedCount}/${phoneData.length})`);
          
        } else {
          // Partial completion - create new chunk with remaining phones
          const remainingPhones = phoneData.slice(processedCount);
          
          console.log(`⚠️ Chunk partially completed: ${processedCount}/${phoneData.length}`);
          console.log(`   Creating new chunk with ${remainingPhones.length} remaining phones`);
          
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
            
            console.log(`✅ New chunk created at offset ${chunk.chunk_offset + processedCount}`);
          } else {
            console.log(`⚠️ Skipping new chunk - would exceed file total`);
          }
          
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'completed'
             WHERE id = ?`,
            [chunk.id]
          );
          
          console.log(`✅ Original chunk marked complete`);
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
        
        console.log(`✅ Chunk completed: ${updatedFile[0].processing_offset}/${file.processing_total} (${updatedFile[0].processing_progress}%)`);
        console.log(`   Cache hits: ${cacheHits}, API calls: ${apiCalls}`);
        
      } catch (chunkError) {
        console.error('Chunk processing error:', chunkError);
        
        await pool.execute(
          `UPDATE processing_chunks 
           SET chunk_status = 'failed'
           WHERE id = ?`,
          [chunk.id]
        );
        
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
      console.log(`\n🎉 FILE ${file.id} COMPLETED!`);
      
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
      
      console.log(`\n📊 Quality Check:`);
      console.log(`   Total: ${stats.total}`);
      console.log(`   iPhones: ${stats.iphones} (${iphonePct.toFixed(1)}%)`);
      console.log(`   Errors: ${stats.errors} (${errorPct.toFixed(1)}%)`);
      
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
    console.log(`\n✓ Processed ${totalProcessed} phones in ${chunksProcessed} chunks`);
    console.log(`✓ Elapsed time: ${elapsedTime}s`);
    
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