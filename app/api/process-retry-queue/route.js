import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { checkBlooioSingle, blooioRateLimiter } from '../../../lib/blooioClient.js';
import { savePhoneCheckWithFile } from '../../../lib/db.js';

export const maxDuration = 300;

const RETRY_BATCH_SIZE = 50; // Process 50 failed numbers at a time
const MAX_TOTAL_RETRIES = 5; // Give up after 5 total attempts

export async function POST(request) {
  let connection;
  
  try {
    const { fileId } = await request.json();
    
    console.log(`\n=== Processing Retry Queue ${fileId ? `for File ${fileId}` : '(all files)'} ===`);
    
    connection = await getConnection();
    
    // Get failed numbers to retry
    const query = fileId 
      ? `SELECT * FROM retry_queue 
         WHERE file_id = ? AND status = 'queued' AND retry_count < ?
         ORDER BY retry_count ASC, created_at ASC
         LIMIT ?`
      : `SELECT * FROM retry_queue 
         WHERE status = 'queued' AND retry_count < ?
         ORDER BY retry_count ASC, created_at ASC
         LIMIT ?`;
    
    const params = fileId 
      ? [fileId, MAX_TOTAL_RETRIES, RETRY_BATCH_SIZE]
      : [MAX_TOTAL_RETRIES, RETRY_BATCH_SIZE];
    
    const [retryItems] = await connection.execute(query, params);
    
    if (retryItems.length === 0) {
      console.log('✅ No items in retry queue');
      return NextResponse.json({
        success: true,
        message: 'Retry queue empty',
        processed: 0
      });
    }
    
    console.log(`📋 Found ${retryItems.length} numbers to retry`);
    
    let successCount = 0;
    let failCount = 0;
    let permanentFailCount = 0;
    
    for (const item of retryItems) {
      console.log(`\n🔄 Retrying ${item.phone_number} (attempt ${item.retry_count + 1}/${MAX_TOTAL_RETRIES})`);
      
      // Mark as retrying
      await connection.execute(
        `UPDATE retry_queue SET status = 'retrying' WHERE id = ?`,
        [item.id]
      );
      
      // Rate limit
      await blooioRateLimiter.acquire();
      
      try {
        const result = await checkBlooioSingle(item.e164_format);
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        // Success!
        console.log(`  ✅ Success for ${item.phone_number}`);
        successCount++;
        
        // Save to cache
        await savePhoneCheckWithFile({
          phone_number: item.e164_format,
          is_ios: result.is_ios,
          supports_imessage: result.supports_imessage,
          supports_sms: result.supports_sms,
          contact_type: result.contact_type,
          contact_id: result.contact_id,
          error: null,
          batch_id: null,
          source: 'blooio_retry'
        }, item.file_id);
        
        // Mark as success and remove from queue
        await connection.execute(
          `UPDATE retry_queue SET status = 'success' WHERE id = ?`,
          [item.id]
        );
        
        // Update file's successful count
        await connection.execute(
          `UPDATE uploaded_files 
           SET valid_numbers = valid_numbers + 1 
           WHERE id = ?`,
          [item.file_id]
        );
        
      } catch (error) {
        console.error(`  ❌ Retry failed: ${error.message}`);
        failCount++;
        
        const newRetryCount = item.retry_count + 1;
        
        if (newRetryCount >= MAX_TOTAL_RETRIES) {
          // Permanent failure - give up
          console.error(`  ❌ Permanent failure after ${MAX_TOTAL_RETRIES} attempts`);
          permanentFailCount++;
          
          await connection.execute(
            `UPDATE retry_queue 
             SET status = 'failed', 
                 retry_count = ?,
                 last_error = ?
             WHERE id = ?`,
            [newRetryCount, error.message, item.id]
          );
        } else {
          // Queue for another retry
          console.log(`  📋 Re-queued for retry (${newRetryCount}/${MAX_TOTAL_RETRIES})`);
          
          await connection.execute(
            `UPDATE retry_queue 
             SET status = 'queued',
                 retry_count = ?,
                 last_error = ?,
                 last_attempt = NOW()
             WHERE id = ?`,
            [newRetryCount, error.message, item.id]
          );
        }
      }
      
      // Small delay between retries
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\n--- RETRY SUMMARY ---`);
    console.log(`Processed: ${retryItems.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Still failing: ${failCount - permanentFailCount}`);
    console.log(`Permanent failures: ${permanentFailCount}`);
    console.log('=== Retry Complete ===\n');
    
    return NextResponse.json({
      success: true,
      processed: retryItems.length,
      successful: successCount,
      failed: failCount,
      permanentlyFailed: permanentFailCount,
      message: `Processed ${retryItems.length} retry items`
    });
    
  } catch (error) {
    console.error('❌ Retry queue processing error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}