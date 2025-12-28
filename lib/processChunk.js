import { getConnection } from './db.js';
import { checkBlooioSingle } from './blooioClient.js';
import { getFromAppCache, saveToAppCache } from './appCache.js';

export async function processBlooioChunk(fileId, chunkId) {
  const chunkStartTime = Date.now();
  const MAX_PROCESSING_TIME = 280000; // 280 seconds
  const MAX_RETRIES = 3;
  
  console.log(`\n=== PROCESSING BLOOIO CHUNK ===`);
  console.log(`File ID: ${fileId}`);
  console.log(`Chunk ID: ${chunkId}`);
  
  try {
    const connection = await getConnection();
    
    // Get chunk data
    const [chunks] = await connection.execute(
      `SELECT * FROM processing_chunks WHERE id = ?`,
      [chunkId]
    );
    
    if (chunks.length === 0) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    
    const chunk = chunks[0];
    const phones = JSON.parse(chunk.chunk_data);
    
    console.log(`📦 Processing ${phones.length} phones`);
    
    // Check cache first
    const e164Numbers = phones.map(p => p.e164);
    const cacheResults = await getFromAppCache(e164Numbers);
    
    const cachedPhones = [];
    const uncachedPhones = [];
    
    phones.forEach(phone => {
      const cached = cacheResults[phone.e164];
      if (cached) {
        cachedPhones.push({
          ...phone,
          ...cached,
          from_cache: true
        });
      } else {
        uncachedPhones.push(phone);
      }
    });
    
    console.log(`✓ Cache hits: ${cachedPhones.length}`);
    console.log(`✓ Cache misses: ${uncachedPhones.length}`);
    
    const chunkResults = [...cachedPhones];
    let apiCalls = 0;
    const failedNumbers = [];
    
    // Process uncached phones in parallel batches
    if (uncachedPhones.length > 0) {
      console.log(`\n--- Processing ${uncachedPhones.length} uncached phones ---`);
      
      const BATCH_SIZE = 4;
      
      for (let batchStart = 0; batchStart < uncachedPhones.length; batchStart += BATCH_SIZE) {
        // Timeout check
        if (Date.now() - chunkStartTime > MAX_PROCESSING_TIME) {
          console.warn(`⚠️ Timeout - processed ${apiCalls}/${uncachedPhones.length}`);
          break;
        }
        
        const batch = uncachedPhones.slice(batchStart, batchStart + BATCH_SIZE);
        
        const batchPromises = batch.map(async (phone) => {
          let result = null;
          let lastError = null;
          
          for (let retry = 0; retry <= MAX_RETRIES; retry++) {
            try {
              if (retry > 0) {
                await new Promise(r => setTimeout(r, Math.pow(2, retry - 1) * 1000));
              }
              
              result = await checkBlooioSingle(phone.e164);
              
              if (result.error && retry < MAX_RETRIES) {
                lastError = result.error;
                continue;
              }
              
              break;
            } catch (error) {
              lastError = error.message;
            }
          }
          
          return { phone, result, lastError };
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(({ phone, result, lastError }) => {
          if (result && result.is_ios !== null) {
            apiCalls++;
            
            const phoneResult = {
              phone_number: phone.original,
              e164: phone.e164,
              is_ios: result.is_ios,
              supports_imessage: result.supports_imessage,
              supports_sms: result.supports_sms,
              contact_type: result.contact_type,
              contact_id: result.contact_id,
              error: result.error,
              from_cache: false
            };
            
            chunkResults.push(phoneResult);
            
            // Save to cache
            saveToAppCache(phone.e164, {
              is_ios: result.is_ios,
              supports_imessage: result.supports_imessage,
              supports_sms: result.supports_sms,
              contact_type: result.contact_type,
              contact_id: result.contact_id,
              error: result.error
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
              error: `Failed: ${lastError}`,
              from_cache: false
            });
          }
        });
        
        if ((batchStart + BATCH_SIZE) % 40 === 0) {
          console.log(`  Progress: ${batchStart + BATCH_SIZE}/${uncachedPhones.length}`);
        }
      }
    }
    
    // Save results to database
    console.log(`\n--- Saving ${chunkResults.length} results ---`);
    
    if (chunkResults.length > 0) {
      const values = chunkResults.map(r => 
        `(${fileId}, ${connection.escape(r.phone_number)}, ${connection.escape(r.e164)}, ` +
        `${r.is_ios ? 1 : 0}, ${r.supports_imessage ? 1 : 0}, ${r.supports_sms ? 1 : 0}, ` +
        `${connection.escape(r.contact_type)}, ${connection.escape(r.contact_id)}, ` +
        `${connection.escape(r.error)}, ${r.from_cache ? 1 : 0})`
      ).join(',');
      
      await connection.execute(
        `INSERT INTO blooio_results 
         (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, 
          contact_type, contact_id, error, from_cache)
         VALUES ${values}`
      );
    }
    
    // Update chunk status
    await connection.execute(
      `UPDATE processing_chunks SET chunk_status = 'completed' WHERE id = ?`,
      [chunkId]
    );
    
    // Update file progress
    const newOffset = chunk.chunk_offset + phones.length;
    
    const [fileInfo] = await connection.execute(
      `SELECT processing_total FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    const progress = (newOffset / fileInfo[0].processing_total * 100).toFixed(2);
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_offset = ?,
           processing_progress = ?
       WHERE id = ?`,
      [newOffset, progress, fileId]
    );
    
    console.log(`✅ Chunk completed: ${newOffset}/${fileInfo[0].processing_total} (${progress}%)`);
    
    return {
      success: true,
      processed: chunkResults.length,
      apiCalls: apiCalls,
      cached: cachedPhones.length,
      failed: failedNumbers.length
    };
    
  } catch (error) {
    console.error('Chunk processing error:', error);
    
    // Mark chunk as failed
    try {
      const connection = await getConnection();
      await connection.execute(
        `UPDATE processing_chunks SET chunk_status = 'failed' WHERE id = ?`,
        [chunkId]
      );
    } catch (dbError) {
      console.error('Failed to update chunk status:', dbError);
    }
    
    throw error;
  }
}