import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { processChunk } from '../check-batch-blooio-chunked/route.js'; // ✅ Direct import

export const maxDuration = 300;

async function processQueue() {
  const connection = await getConnection();
  
  try {
    console.log('🔄 Queue worker checking for files to process...');
    
    const [files] = await connection.execute(
      `SELECT * FROM uploaded_files
       WHERE processing_status IN ('initialized', 'processing', 'uploaded')
         AND processing_offset < processing_total
         AND processing_state IS NOT NULL
         AND (can_resume = 1 OR can_resume IS NULL)
       ORDER BY 
         CASE 
           WHEN processing_status = 'processing' THEN 1
           WHEN processing_status = 'initialized' THEN 2
           ELSE 3
         END,
         upload_date ASC
       LIMIT 1`
    );
    
    if (files.length === 0) {
      console.log('✅ No files need processing');
      return {
        success: true, 
        message: 'Queue empty - all files processed'
      };
    }
    
    const file = files[0];
    console.log(`🚀 Processing file ${file.id}: ${file.file_name}`);
    console.log(`   Progress: ${file.processing_offset}/${file.processing_total}`);
    
    // ✅ Direct function call instead of fetch
    const result = await processChunk(file.id, file.processing_offset);
    
    if (result.success) {
      console.log(`✅ Chunk processed: ${result.processed}/${result.total} (${result.progress}%)`);
      
      if (result.isComplete) {
        console.log(`🎉 File ${file.id} completed!`);
      }
      
      return {
        success: true,
        message: result.isComplete ? 'File completed' : 'Chunk completed',
        fileId: file.id,
        progress: result.progress
      };
    } else {
      console.error(`❌ Chunk failed: ${result.error}`);
      return {
        success: false,
        error: result.error
      };
    }
    
  } catch (error) {
    console.error('❌ Queue worker error:', error);
    throw error;
  }
}

export async function GET(request) {
  console.log('=== CRON JOB TRIGGERED (GET) ===');
  
  try {
    const result = await processQueue();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function POST(request) {
  console.log('=== MANUAL TRIGGER (POST) ===');
  
  try {
    const result = await processQueue();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}