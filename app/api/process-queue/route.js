import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 300; // 5 minutes

export async function POST(request) {
  const connection = await getConnection();
  
  try {
    console.log('🔄 Queue worker checking for pending files...');
    
    // Get next file to process
    const [queueItems] = await connection.execute(
      `SELECT q.*, f.* 
       FROM processing_queue q
       JOIN uploaded_files f ON q.file_id = f.id
       WHERE q.status = 'queued'
       ORDER BY q.priority DESC, q.created_at ASC
       LIMIT 1`
    );
    
    if (queueItems.length === 0) {
      console.log('✅ Queue empty');
      return NextResponse.json({ 
        success: true, 
        message: 'Queue empty',
        hasMore: false
      });
    }
    
    const item = queueItems[0];
    console.log(`🚀 Processing file ${item.file_id}: ${item.file_name}`);
    
    // Mark as processing
    await connection.execute(
      `UPDATE processing_queue 
       SET status = 'processing', started_at = NOW() 
       WHERE id = ?`,
      [item.id]
    );
    
    // Process one chunk
    const service = item.processing_state?.includes('"service":"blooio"') ? 'blooio' : 'subscriberverify';
    const apiEndpoint = service === 'blooio' 
      ? '/api/check-batch-blooio-chunked'
      : '/api/check-batch-chunked';
    
    const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}${apiEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileId: item.file_id, 
        resumeFrom: item.processing_offset || 0 
      })
    });
    
    const result = await response.json();
    
    if (result.isComplete) {
      // Mark as completed
      await connection.execute(
        `UPDATE processing_queue 
         SET status = 'completed', completed_at = NOW() 
         WHERE id = ?`,
        [item.id]
      );
      
      console.log(`✅ File ${item.file_id} completed`);
      
      return NextResponse.json({
        success: true,
        message: 'File completed',
        fileId: item.file_id,
        hasMore: true // Check for more files
      });
    } else {
      // Still processing, reset to queued for next chunk
      await connection.execute(
        `UPDATE processing_queue 
         SET status = 'queued' 
         WHERE id = ?`,
        [item.id]
      );
      
      console.log(`⏳ File ${item.file_id} chunk completed, more to process`);
      
      return NextResponse.json({
        success: true,
        message: 'Chunk completed',
        fileId: item.file_id,
        progress: result.processed,
        total: result.total,
        hasMore: true
      });
    }
    
  } catch (error) {
    console.error('Queue worker error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}