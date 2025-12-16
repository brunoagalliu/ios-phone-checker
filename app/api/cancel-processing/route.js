import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({
        success: false,
        error: 'File ID is required'
      }, { status: 400 });
    }
    
    console.log(`Cancelling processing for file ${fileId}...`);
    
    const connection = await getConnection();
    
    // Remove from queue if exists
    await connection.execute(
      `DELETE FROM processing_queue WHERE file_id = ?`,
      [fileId]
    );
    
    // Update file status to failed/cancelled
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'failed',
           can_resume = 0
       WHERE id = ?`,
      [fileId]
    );
    
    console.log(`✓ File ${fileId} cancelled`);
    
    return NextResponse.json({
      success: true,
      message: 'Processing cancelled',
      fileId: fileId
    });
    
  } catch (error) {
    console.error('Cancel processing error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}