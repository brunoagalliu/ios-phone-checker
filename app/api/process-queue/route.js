import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ✅ Main processing function
async function processQueue(request) {
  const startTime = Date.now();
  const MAX_PROCESSING_TIME = 280000;
  
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
        
        for (const phone of phoneData) {
            if (Date.now() - startTime > MAX_PROCESSING_TIME) {
              console.log(`⚠️ Timeout - processed ${processedCount}/${phoneData.length}`);
              break;
            }
            
            // ✅ Add detailed logging
            if (processedCount % 10 === 0) {
              console.log(`\n📞 Phone ${processedCount + 1}/${phoneData.length}: ${phone.e164}`);
            }
            
            // Check cache first
            const [cachedRows] = await pool.execute(
              `SELECT * FROM blooio_cache WHERE e164 = ? LIMIT 1`,
              [phone.e164]
            );
            
            // ✅ Log first few cache attempts
            if (processedCount < 5) {
              console.log(`   🔍 Cache lookup for: "${phone.e164}"`);
              console.log(`   📊 Result: ${cachedRows.length} rows`);
              if (cachedRows.length > 0) {
                console.log(`   ✅ CACHE HIT!`, cachedRows[0]);
              } else {
                console.log(`   ❌ CACHE MISS - will call API`);
                
                // Check if it exists with different format
                const [testRows] = await pool.execute(
                  `SELECT e164 FROM blooio_cache WHERE e164 LIKE ? LIMIT 1`,
                  [`%${phone.e164.slice(-10)}%`]
                );
                if (testRows.length > 0) {
                  console.log(`   ⚠️ Found similar in cache: "${testRows[0].e164}"`);
                }
              }
            }
            
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
          
          // Not in cache - call Blooio API
try {
    // ✅ Correct Blooio API endpoint
    const response = await fetch(
      `https://backend.blooio.com/v1/api/contacts/${encodeURIComponent(phone.e164)}/capabilities`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    
    if (!response.ok) {
      console.error(`Blooio API error ${response.status} for ${phone.e164}`);
      throw new Error(`Blooio API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse Blooio response format
    const capabilities = data?.capabilities || {};
    const supportsIMessage = capabilities.imessage === true;
    const supportsSMS = capabilities.sms === true;
    
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
    
    // Save to cache
    // Save to cache
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
    
    processedCount++;
    apiCalls++;
    
    // Rate limiting - 4 req/sec
    await new Promise(resolve => setTimeout(resolve, 250));
    
  } catch (error) {
    console.error(`API error for ${phone.e164}:`, error.message);
    
    results.push({
      phone_number: phone.original,
      e164: phone.e164,
      is_ios: 0,
      supports_imessage: 0,
      supports_sms: 0,
      contact_type: null,
      error: error.message,
      from_cache: false
    });
    
    processedCount++;
  }
        }
        // Save results
        if (results.length > 0) {
            console.log(`--- Saving ${results.length} results ---`);
            
            try {
              const values = results.map(r => 
                `(${file.id}, ${pool.escape(r.phone_number)}, ${pool.escape(r.e164)}, ${r.is_ios}, ${r.supports_imessage}, ${r.supports_sms}, ${pool.escape(r.contact_type)}, ${pool.escape(r.error)}, ${r.from_cache ? 1 : 0})`
              ).join(',');
              
              await pool.execute(
                `INSERT INTO blooio_results 
                 (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, contact_type, error, from_cache)
                 VALUES ${values}`
              );
              
              console.log(`✅ Saved ${results.length} results to database`);
              
            } catch (saveError) {
              console.error('❌ Failed to save results:', saveError);
              throw saveError;
            }
          }
          
          // Mark chunk as completed
          await pool.execute(
            `UPDATE processing_chunks 
             SET chunk_status = 'completed'
             WHERE id = ?`,
            [chunk.id]
          );
          
          console.log(`✅ Marked chunk ${chunk.id} as completed`);
          
          // ✅ UPDATE FILE PROGRESS - Use database-side increment
          console.log(`📊 Updating file progress: +${processedCount} phones`);
          
          await pool.execute(
            `UPDATE uploaded_files 
             SET processing_offset = processing_offset + ?,
                 processing_progress = ROUND((processing_offset + ?) / processing_total * 100, 2)
             WHERE id = ?`,
            [processedCount, processedCount, file.id]
          );
          
          // Verify the update worked
          const [verifyFile] = await pool.execute(
            `SELECT processing_offset, processing_progress FROM uploaded_files WHERE id = ?`,
            [file.id]
          );
          
          console.log(`   New offset: ${verifyFile[0].processing_offset} / ${file.processing_total}`);
          console.log(`   New progress: ${verifyFile[0].processing_progress}%`);
          
          totalProcessed += processedCount;
          chunksProcessed++;
          
          console.log(`✅ Chunk completed: ${verifyFile[0].processing_offset}/${file.processing_total} (${verifyFile[0].processing_progress}%)`);
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
    
    const [updatedFile] = await pool.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [file.id]
    );
    
    const currentFile = updatedFile[0];
    
    if (currentFile.processing_offset >= currentFile.processing_total) {
      console.log(`\n🎉 FILE ${file.id} COMPLETED!`);
      
      await pool.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100
         WHERE id = ?`,
        [file.id]
      );
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

// ✅ Export both GET and POST handlers
export async function GET(request) {
  return processQueue(request);
}

export async function POST(request) {
  return processQueue(request);
}