import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { processBlooioChunk } from '../../../lib/processChunk.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function processQueue() {
  console.log('🔄 Queue worker checking for files to process...');
  
  try {
    const connection = await getConnection();
    
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
      console.log('✅ File processing complete!');
      
      await connection.execute(
        `UPDATE uploaded_files SET processing_status = 'completed' WHERE id = ?`,
        [file.id]
      );
      
      return NextResponse.json({
        success: true,
        message: `File ${file.id} completed`
      });
    }
    
    const chunk = chunks[0];
    
    console.log(`📦 Processing chunk ${chunk.id} at offset ${chunk.chunk_offset}`);
    
    // Mark as processing
    await connection.execute(
      `UPDATE processing_chunks SET chunk_status = 'processing' WHERE id = ?`,
      [chunk.id]
    );
    
    if (file.processing_status !== 'processing') {
      await connection.execute(
        `UPDATE uploaded_files SET processing_status = 'processing' WHERE id = ?`,
        [file.id]
      );
    }
    
    // Process chunk directly (no HTTP call!)
    const result = await processBlooioChunk(file.id, chunk.id);
    
    console.log(`✓ Chunk processed: ${result.processed} phones, ${result.apiCalls} API calls`);
    
    return NextResponse.json({
      success: true,
      message: `Processed chunk for file ${file.id}`,
      fileId: file.id,
      chunkId: chunk.id,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Queue error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET(request) {
  console.log('=== CRON JOB TRIGGERED (GET) ===');
  return processQueue();
}

export async function POST(request) {
  console.log('=== MANUAL TRIGGER (POST) ===');
  return processQueue();
}