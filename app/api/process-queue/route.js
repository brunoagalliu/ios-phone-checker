import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ✅ Logging control
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const shouldLog = {
  debug: LOG_LEVEL === 'DEBUG',
  info: ['DEBUG', 'INFO'].includes(LOG_LEVEL),
  warn: ['DEBUG', 'INFO', 'WARN'].includes(LOG_LEVEL),
  error: true
};

async function processQueue(request) {
  const startTime = Date.now();
  const MAX_PROCESSING_TIME = 280000; // 280 seconds
  
  if (shouldLog.info) {
    console.log(`[${new Date().toISOString()}] Process queue started`);
  }
  
  const pool = await getConnection();
  
  // ✅ CRITICAL: Prevent parallel processing with database lock
  let hasLock = false;
  try {
    const [lockResult] = await pool.execute(
      `SELECT GET_LOCK('process_queue_lock', 0) as locked`
    );
    
    if (lockResult[0].locked !== 1) {
      if (shouldLog.warn) {
        console.warn('Another instance already processing, skipping');
      }
      return NextResponse.json({
        success: true,
        message: 'Another instance already processing',
        skipped: true
      });
    }
    
    hasLock = true;
    
    // ✅ Get next file to process (only ONE file at a time)
    const [files] = await pool.execute(
      `SELECT * FROM uploaded_files 
       WHERE processing_status IN ('initialized', 'processing')
       AND processing_offset < processing_total
       ORDER BY upload_date ASC
       LIMIT 1`
    );
    
    if (files.length === 0) {
      if (shouldLog.info) {
        console.log('No files to process');
      }
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
    
    let totalProcessed = 0;
    let chunksProcessed = 0;
    
    while (Date.now() - startTime < MAX_PROCESSING_TIME) {
      // ✅ Get next pending chunk
      const [chunks] = await pool.execute(
        `SELECT * FROM processing_chunks
         WHERE file_id = ? 
         AND chunk_status IN ('pending', 'failed')
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
        if (shouldLog.info) {
          console.log('No more chunks to process');
        }
        break;
      }
      
      const chunk = chunks[0];
      if (shouldLog.debug) {
        console.log(`Chunk ${chunk.id} offset ${chunk.chunk_offset}`);
      }
      
      await pool.execute(
        `UPDATE processing_chunks 
         SET chunk_status = 'processing'
         WHERE id = ?`,
        [chunk.id]
      );
      
      try {
        const phoneData = JSON.parse(chunk.chunk_data);
        if (shouldLog.debug) {
          console.log(`Phones in chunk: ${phoneData.length}`);
        }
        
        const results = [];
        let processedCount = 0;
        let cacheHits = 0;
        let apiCalls = 0;
        
        // ✅ Rate limiting: STRICT 2 req/sec (500ms between calls)
        let lastApiCallTime = 0;
        const MIN_API_INTERVAL = 500;
        const MAX_RETRIES = 3;
        
        for (let i = 0; i < phoneData.length; i++) {
          if (Date.now() - startTime > MAX_PROCESSING_TIME) {
            if (shouldLog.warn) {
              console.log(`Timeout - processed ${processedCount}/${phoneData.length}`);
            }
            break;
          }
          
          const phone = phoneData[i];
          
          // ✅ Check cache FIRST (use blooio_cache only!)
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
            continue;
          }
          
          // ✅ Not in cache - call API with STRICT rate limiting
          let success = false;
          let lastError = null;
          
          for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
            try {
              // ✅ ENFORCE strict 500ms between API calls
              const now = Date.now();
              const timeSinceLastCall = now - lastApiCallTime;
              
              if (lastApiCallTime > 0) {
                const waitTime = Math.max(MIN_API_INTERVAL - timeSinceLastCall, 0);
                if (waitTime > 0) {
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                }
              }
              
              // Record time BEFORE API call
              lastApiCallTime = Date.now();
              
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
              
              if (!response.ok) {
                if (response.status === 429) {
                  console.warn(`Rate limit hit for ${phone.e164} - waiting 5s`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  continue;
                }
                
                if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
                  if (shouldLog.warn) {
                    console.warn(`Server error ${response.status} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  continue;
                }
                
                throw new Error(`API ${response.status}`);
              }
              
              const data = await response.json();
              
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
              
              if (!supportsIMessage && !supportsSMS && shouldLog.warn) {
                console.warn(`No capabilities: ${phone.e164}`);
              }
              
              const contactType = supportsIMessage ? 'iPhone' : (supportsSMS ? 'Android' : 'Unknown');
              
              if (shouldLog.debug) {
                console.log(`${phone.e164}: ${contactType}`);
              }
              
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
              
              results.push(result);
              
              // ✅ Cache successful results only
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
              
            } catch (error) {
              lastError = error;
              
              if ((error.message.includes('timeout') || 
                   error.message.includes('ECONNRESET') || 
                   error.message.includes('fetch failed')) && 
                  attempt < MAX_RETRIES - 1) {
                if (shouldLog.warn) {
                  console.warn(`${error.message} for ${phone.e164}, retry ${attempt + 2}/${MAX_RETRIES}`);
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
              }
              
              break;
            }
          }
          
          if (!success) {
            console.error(`Failed for ${phone.e164}: ${lastError?.message}`);
            
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
          
          // Log progress every 100 phones
          if (shouldLog.info && processedCount % 100 === 0) {
            console.log(`${processedCount}/${phoneData.length} phones (Cache: ${cacheHits}, API: ${apiCalls})`);
          }
        }
        
        // ✅ Save results
        if (results.length > 0) {
          if (shouldLog.debug) {
            console.log(`Saving ${results.length} results`);
          }
          
          const values = results.map(r => 
            `(${file.id}, ${pool.escape(r.phone_number)}, ${pool.escape(r.e164)}, ${r.is_ios}, ${r.supports_imessage}, ${r.supports_sms}, ${pool.escape(r.contact_type)}, ${pool.escape(r.error)}, ${r.from_cache ? 1 : 0})`
          ).join(',');
          
          await pool.execute(
            `INSERT INTO blooio_results 
             (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, contact_type, error, from_cache)
             VALUES ${values}`
          );
        }
        
        // ✅ Check if chunk was fully processed
        const fullyProcessed = processedCount === phoneData.length;
        
        if (fullyProcessed) {
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'completed'
             WHERE id = ?`,
            [chunk.id]
          );
        } else {
          // Partial completion - create new chunk with remaining
          const remainingPhones = phoneData.slice(processedCount);
          
          if (shouldLog.info) {
            console.log(`Chunk partial: ${processedCount}/${phoneData.length}, new chunk: ${remainingPhones.length} phones`);
          }
          
          const [fileCheck] = await pool.execute(
            `SELECT processing_offset, processing_total FROM uploaded_files WHERE id = ?`,
            [file.id]
          );
          
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
          }
          
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'completed'
             WHERE id = ?`,
            [chunk.id]
          );
        }
        
        // ✅ Update file progress
        await pool.execute(
          `UPDATE uploaded_files 
           SET processing_offset = processing_offset + ?,
               processing_progress = ROUND((processing_offset + ?) / processing_total * 100, 2)
           WHERE id = ?`,
          [processedCount, processedCount, file.id]
        );
        
        const [updatedFile] = await pool.execute(
          `SELECT processing_offset, processing_progress FROM uploaded_files WHERE id = ?`,
          [file.id]
        );
        
        totalProcessed += processedCount;
        chunksProcessed++;
        
        if (shouldLog.info) {
          console.log(`Progress: ${updatedFile[0].processing_offset}/${file.processing_total} (${updatedFile[0].processing_progress}%)`);
        }
        
        // Log actual API rate
        if (shouldLog.info && apiCalls > 0) {
          const chunkDuration = (Date.now() - startTime) / 1000;
          const actualRate = apiCalls / chunkDuration;
          console.log(`API rate: ${actualRate.toFixed(2)} req/sec`);
          
          if (actualRate > 2.1) {
            console.warn(`WARNING: Rate exceeded 2 req/sec! Actual: ${actualRate.toFixed(2)}`);
          }
        }
        
      } catch (chunkError) {
        console.error('Chunk error:', chunkError.message);
        
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
    
    // ✅ Check if file is complete
    const [updatedFile] = await pool.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [file.id]
    );
    
    const currentFile = updatedFile[0];
    
    const [pendingChunks] = await pool.execute(
      `SELECT COUNT(*) as pending_count 
       FROM processing_chunks 
       WHERE file_id = ? 
       AND chunk_status IN ('pending', 'processing')`,
      [file.id]
    );
    
    if (currentFile.processing_offset >= currentFile.processing_total && pendingChunks[0].pending_count === 0) {
      // ✅ Quality check
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
      
      console.log(`File ${file.id} completed: ${stats.iphones} iPhones (${iphonePct.toFixed(1)}%), ${stats.errors} errors (${errorPct.toFixed(1)}%)`);
      
      if (iphonePct < 30 || errorPct > 10) {
        console.warn(`Quality warning: ${iphonePct.toFixed(1)}% iPhones, ${errorPct.toFixed(1)}% errors`);
      }
      
      await pool.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100
         WHERE id = ?`,
        [file.id]
      );
    }
    
    if (shouldLog.info) {
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Processed ${totalProcessed} phones, ${chunksProcessed} chunks, ${elapsedTime}s`);
    }
    
    return NextResponse.json({
      success: true,
      fileId: file.id,
      fileName: file.file_name,
      chunksProcessed: chunksProcessed,
      phonesProcessed: totalProcessed,
      progress: currentFile.processing_progress,
      elapsedTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
  } catch (error) {
    console.error('Process queue error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } finally {
    // ✅ ALWAYS release lock
    if (hasLock) {
      try {
        await pool.execute(`SELECT RELEASE_LOCK('process_queue_lock')`);
      } catch (err) {
        console.error('Lock release error:', err);
      }
    }
  }
}

export async function GET(request) {
  return processQueue(request);
}

export async function POST(request) {
  return processQueue(request);
}