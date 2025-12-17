import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;

// Main processing logic (shared between GET and POST)
async function processQueue() {
  const connection = await getConnection();
  
  try {
    console.log('🔄 Queue worker checking for files to process...');
    
    // Check ALL files first (debug)
    const [allFiles] = await connection.execute(
      `SELECT 
        id,
        file_name,
        processing_status,
        processing_offset,
        processing_total,
        can_resume,
        processing_state IS NOT NULL as has_state
       FROM uploaded_files
       WHERE processing_offset < processing_total
       ORDER BY upload_date DESC
       LIMIT 5`
    );
    
    console.log(`Found ${allFiles.length} incomplete files`);
    if (allFiles.length > 0) {
      console.log('Incomplete files:', JSON.stringify(allFiles.map(f => ({
        id: f.id,
        name: f.file_name,
        status: f.processing_status,
        offset: f.processing_offset,
        total: f.processing_total,
        can_resume: f.can_resume,
        has_state: f.has_state
      })), null, 2));
    }
    
    // Get files that meet ALL criteria
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
      console.log('   (Checked files with: status in [initialized,processing,uploaded], offset < total, has state)');
      return {
        success: true, 
        message: 'Queue empty - all files processed',
        debug: {
          incompleteFiles: allFiles.length,
          files: allFiles.map(f => ({
            id: f.id,
            name: f.file_name,
            status: f.processing_status,
            can_resume: f.can_resume
          }))
        }
      };
    }
    
    const file = files[0];
    console.log(`🚀 Processing file ${file.id}: ${file.file_name}`);
    console.log(`   Progress: ${file.processing_offset}/${file.processing_total} (${((file.processing_offset/file.processing_total)*100).toFixed(1)}%)`);
    console.log(`   Status: ${file.processing_status}`);
    console.log(`   Can Resume: ${file.can_resume}`);
    
    // Determine service
    const processingState = JSON.parse(file.processing_state);
    const service = processingState.service || 'blooio';
    const apiEndpoint = service === 'blooio' 
      ? '/api/check-batch-blooio-chunked'
      : '/api/check-batch-chunked';
    
    console.log(`   Service: ${service}`);
    console.log(`   Endpoint: ${apiEndpoint}`);
    
    // Process one chunk
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://ios.trackthisclicks.com';
    
    console.log(`   Calling: ${baseUrl}${apiEndpoint}`);
    
    const response = await fetch(`${baseUrl}${apiEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileId: file.id, 
        resumeFrom: file.processing_offset 
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Endpoint returned ${response.status}: ${errorText}`);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Chunk processed: ${result.processed}/${result.total} (${result.progress}%)`);
      console.log(`   Cache hits: ${result.cacheHits}, API calls: ${result.apiCalls}`);
      
      if (result.isComplete) {
        console.log(`🎉 File ${file.id} completed!`);
      } else {
        console.log(`⏭️ More chunks remaining, will continue on next cron run`);
      }
      
      return {
        success: true,
        message: result.isComplete ? 'File completed' : 'Chunk completed',
        fileId: file.id,
        progress: result.progress,
        isComplete: result.isComplete
      };
    } else {
      console.error(`❌ Chunk failed: ${result.error}`);
      return {
        success: false,
        error: result.error,
        fileId: file.id
      };
    }
    
  } catch (error) {
    console.error('❌ Queue worker error:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// GET handler for Vercel Cron
export async function GET(request) {
  console.log('=== CRON JOB TRIGGERED (GET) ===');
  
  try {
    const result = await processQueue();
    return NextResponse.json(result);
  } catch (error) {
    console.error('GET handler error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// POST handler for manual triggers
export async function POST(request) {
  console.log('=== MANUAL TRIGGER (POST) ===');
  
  try {
    const result = await processQueue();
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST handler error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}