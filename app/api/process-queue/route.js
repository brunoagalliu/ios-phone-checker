import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;

export async function POST(request) {
  const connection = await getConnection();
  
  try {
    console.log('🔄 Queue worker checking for files to process...');
    
    // Get files that need processing
    const [files] = await connection.execute(
      `SELECT * FROM uploaded_files
       WHERE (processing_status IN ('initialized', 'processing'))
         AND can_resume = 1
         AND processing_offset < processing_total
         AND processing_state IS NOT NULL
       ORDER BY upload_date ASC
       LIMIT 1`
    );
    
    if (files.length === 0) {
      console.log('✅ No files need processing');
      return NextResponse.json({ 
        success: true, 
        message: 'No files in queue' 
      });
    }
    
    const file = files[0];
    console.log(`🚀 Processing file ${file.id}: ${file.file_name}`);
    console.log(`   Progress: ${file.processing_offset}/${file.processing_total}`);
    
    // Determine service
    const processingState = JSON.parse(file.processing_state);
    const service = processingState.service || 'blooio';
    const apiEndpoint = service === 'blooio' 
      ? '/api/check-batch-blooio-chunked'
      : '/api/check-batch-chunked';
    
    // Process one chunk
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://ios.trackthisclicks.com';
    
    const response = await fetch(`${baseUrl}${apiEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileId: file.id, 
        resumeFrom: file.processing_offset 
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Chunk processed: ${result.processed}/${result.total}`);
      
      if (result.isComplete) {
        console.log(`🎉 File ${file.id} completed!`);
      }
      
      return NextResponse.json({
        success: true,
        message: result.isComplete ? 'File completed' : 'Chunk completed',
        fileId: file.id,
        progress: result.progress
      });
    } else {
      console.error(`❌ Chunk failed: ${result.error}`);
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('❌ Queue worker error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}