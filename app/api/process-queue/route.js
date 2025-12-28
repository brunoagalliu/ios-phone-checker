import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Main processing function
async function processQueue() {
  console.log('🔄 Queue worker checking for files to process...');
  
  try {
    const connection = await getConnection();
    
    // Find files that need processing
    const [files] = await connection.execute(
      `SELECT * FROM uploaded_files 
       WHERE processing_status IN ('initialized', 'processing')
       AND processing_offset < processing_total
       ORDER BY upload_date ASC
       LIMIT 1`
    );
    
    console.log(`📋 Found ${files.length} file(s) to process`);
    
    if (files.length === 0) {
      console.log('✅ No files need processing');
      return NextResponse.json({
        success: true,
        message: 'No files to process',
        filesProcessed: 0
      });
    }
    
    const file = files[0];
    
    console.log(`\n=== PROCESSING FILE ${file.id} ===`);
    console.log(`File: ${file.file_name}`);
    console.log(`Service: ${file.service}`);
    console.log(`Progress: ${file.processing_offset}/${file.processing_total} (${file.processing_progress}%)`);
    
    // Get next pending chunk
    const [chunks] = await connection.execute(
      `SELECT * FROM processing_chunks
       WHERE file_id = ?
       AND chunk_status = 'pending'
       ORDER BY chunk_offset ASC
       LIMIT 1`,
      [file.id]
    );
    
    if (chunks.length === 0) {
      console.log('⚠️ No pending chunks found');
      
      // Check if file is complete
      if (file.processing_offset >= file.processing_total) {
        console.log('✅ File processing complete!');
        
        await connection.execute(
          `UPDATE uploaded_files 
           SET processing_status = 'completed'
           WHERE id = ?`,
          [file.id]
        );
        
        return NextResponse.json({
          success: true,
          message: `File ${file.id} completed`,
          fileId: file.id
        });
      }
      
      return NextResponse.json({
        success: true,
        message: 'No chunks to process',
        filesProcessed: 0
      });
    }
    
    const chunk = chunks[0];
    
    console.log(`📦 Processing chunk at offset ${chunk.chunk_offset}`);
    
    // Mark chunk as processing
    await connection.execute(
      `UPDATE processing_chunks 
       SET chunk_status = 'processing'
       WHERE id = ?`,
      [chunk.id]
    );
    
    // Update file status to processing
    if (file.processing_status !== 'processing') {
      await connection.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'processing'
         WHERE id = ?`,
        [file.id]
      );
    }
    
    // Trigger chunk processing based on service
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    let processingEndpoint;
    
    if (file.service === 'blooio') {
      processingEndpoint = `${baseUrl}/api/check-batch-blooio-chunked`;
    } else {
      processingEndpoint = `${baseUrl}/api/check-batch-generic-chunked`;
    }
    
    console.log(`🚀 Triggering: ${processingEndpoint}`);
    
    const response = await fetch(processingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: file.id,
        chunkId: chunk.id
      })
    });
    
    if (!response.ok) {
      throw new Error(`Processing failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log(`✓ Chunk processing triggered`);
    
    return NextResponse.json({
      success: true,
      message: `Started processing file ${file.id}`,
      fileId: file.id,
      chunkId: chunk.id,
      filesProcessed: 1
    });
    
  } catch (error) {
    console.error('❌ Queue processing error:', error);
    
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// Handle GET requests (from cron)
export async function GET(request) {
  console.log('=== CRON JOB TRIGGERED (GET) ===');
  return processQueue();
}

// Handle POST requests (from manual triggers)
export async function POST(request) {
  console.log('=== MANUAL TRIGGER (POST) ===');
  return processQueue();
}