import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const totalChunks = parseInt(formData.get('totalChunks'));
    const chunkData = formData.get('chunk'); // CSV text chunk
    const fileName = formData.get('fileName');
    const service = formData.get('service');
    
    console.log(`📦 Received chunk ${chunkIndex + 1}/${totalChunks} for upload ${uploadId}`);
    
    const connection = await getConnection();
    
    // First chunk: Create upload record
    if (chunkIndex === 0) {
      const [result] = await connection.execute(
        `INSERT INTO uploaded_files 
         (file_name, upload_status, service, upload_date, chunk_count, chunks_received)
         VALUES (?, 'uploading', ?, NOW(), ?, 0)`,
        [fileName, service, totalChunks]
      );
      
      const fileId = result.insertId;
      
      // Store chunk
      await connection.execute(
        `INSERT INTO file_chunks (file_id, chunk_index, chunk_data)
         VALUES (?, ?, ?)`,
        [fileId, chunkIndex, chunkData]
      );
      
      await connection.execute(
        `UPDATE uploaded_files SET chunks_received = 1 WHERE id = ?`,
        [fileId]
      );
      
      return NextResponse.json({
        success: true,
        uploadId: fileId,
        chunkIndex: chunkIndex,
        message: 'First chunk received'
      });
    }
    
    // Subsequent chunks: Store chunk data
    const fileId = parseInt(uploadId);
    
    await connection.execute(
      `INSERT INTO file_chunks (file_id, chunk_index, chunk_data)
       VALUES (?, ?, ?)`,
      [fileId, chunkIndex, chunkData]
    );
    
    // Update chunks received count
    await connection.execute(
      `UPDATE uploaded_files 
       SET chunks_received = chunks_received + 1
       WHERE id = ?`,
      [fileId]
    );
    
    // Check if all chunks received
    const [file] = await connection.execute(
      `SELECT chunks_received, chunk_count FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    const allReceived = file[0].chunks_received === file[0].chunk_count;
    
    if (allReceived) {
      console.log(`✅ All chunks received for upload ${fileId}`);
      
      // Merge chunks and process
      const [chunks] = await connection.execute(
        `SELECT chunk_data FROM file_chunks 
         WHERE file_id = ? 
         ORDER BY chunk_index ASC`,
        [fileId]
      );
      
      const fullContent = chunks.map(c => c.chunk_data).join('');
      const lines = fullContent.trim().split('\n');
      const validCount = lines.length - 1; // Exclude header
      
      // Update file record
      await connection.execute(
        `UPDATE uploaded_files 
         SET upload_status = 'completed',
             processing_status = 'initialized',
             processing_total = ?
         WHERE id = ?`,
        [validCount, fileId]
      );
      
      // Clean up chunks from database
      await connection.execute(
        `DELETE FROM file_chunks WHERE file_id = ?`,
        [fileId]
      );
      
      return NextResponse.json({
        success: true,
        uploadId: fileId,
        chunkIndex: chunkIndex,
        complete: true,
        totalRecords: validCount,
        message: 'Upload complete'
      });
    }
    
    return NextResponse.json({
      success: true,
      uploadId: fileId,
      chunkIndex: chunkIndex,
      complete: false,
      progress: ((file[0].chunks_received / file[0].chunk_count) * 100).toFixed(1)
    });
    
  } catch (error) {
    console.error('Chunk upload error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}