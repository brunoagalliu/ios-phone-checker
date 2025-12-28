import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const totalChunks = parseInt(formData.get('totalChunks'));
    const chunkData = formData.get('chunk');
    const fileName = formData.get('fileName');
    const service = formData.get('service');
    const hasHeader = formData.get('hasHeader') === 'true';
    
    console.log(`📦 Received chunk ${chunkIndex + 1}/${totalChunks} for upload ${uploadId || 'new'}`);
    console.log(`   Has header: ${hasHeader}`);
    console.log(`   Chunk size: ${chunkData.length} chars`);
    
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
      
      console.log(`✓ Created file record ${fileId}`);
      
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
      
      console.log(`✓ Stored chunk 1/${totalChunks}`);
      
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
    
    console.log(`✓ Stored chunk ${chunkIndex + 1}/${totalChunks}`);
    
    // Check if all chunks received
    const [file] = await connection.execute(
      `SELECT chunks_received, chunk_count FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    const allReceived = file[0].chunks_received === file[0].chunk_count;
    
    if (allReceived) {
      console.log(`\n✅ All chunks received for upload ${fileId} - Processing...`);
      
      // Merge chunks
      const [chunks] = await connection.execute(
        `SELECT chunk_data FROM file_chunks 
         WHERE file_id = ? 
         ORDER BY chunk_index ASC`,
        [fileId]
      );
      
      // First chunk has header, rest don't
      const firstChunk = chunks[0].chunk_data; // Has header
      const restChunks = chunks.slice(1).map(c => c.chunk_data).join('\n');
      
      const fullContent = firstChunk + (restChunks ? '\n' + restChunks : '');
      
      console.log(`📄 Merged content length: ${fullContent.length} chars`);
      
      const lines = fullContent.trim().split('\n');
      console.log(`📄 Total lines: ${lines.length}`);
      
      const header = lines[0];
      const dataLines = lines.slice(1);
      
      console.log(`📄 Header: ${header}`);
      console.log(`📄 Data lines: ${dataLines.length}`);

      console.log(`📄 First 5 data lines:`);
for (let i = 0; i < Math.min(5, dataLines.length); i++) {
  console.log(`   Line ${i + 1}: "${dataLines[i]}"`);
}
      
      // Parse phone numbers
      const { parsePhoneNumber, isValidPhoneNumber } = await import('libphonenumber-js');
      
      const validPhones = [];
      const invalidPhones = [];
      let sampleErrorsShown = 0;
      
      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        const phoneNumber = parts[0].trim();
        
        try {
          if (!phoneNumber) {
            if (sampleErrorsShown < 5) {
              console.log(`❌ Line ${i + 1}: Empty phone number`);
              sampleErrorsShown++;
            }
            invalidPhones.push({ line: i + 1, phone: phoneNumber, reason: 'Empty' });
            continue;
          }
          
          if (isValidPhoneNumber(phoneNumber)) {
            const parsed = parsePhoneNumber(phoneNumber);
            validPhones.push({
              original: phoneNumber,
              e164: parsed.format('E.164')
            });
          } else {
            if (sampleErrorsShown < 5) {
              console.log(`❌ Line ${i + 1}: Invalid format - "${phoneNumber}"`);
              sampleErrorsShown++;
            }
            invalidPhones.push({ line: i + 1, phone: phoneNumber, reason: 'Invalid format' });
          }
        } catch (error) {
          if (sampleErrorsShown < 5) {
            console.log(`❌ Line ${i + 1}: Parse error - "${phoneNumber}" - ${error.message}`);
            sampleErrorsShown++;
          }
          invalidPhones.push({ line: i + 1, phone: phoneNumber, reason: error.message });
        }
      }
      
      console.log(`✓ Valid phones: ${validPhones.length}`);
      console.log(`✗ Invalid phones: ${invalidPhones.length}`);
      
      if (invalidPhones.length > 0 && invalidPhones.length < 10) {
        console.log(`Invalid samples:`, invalidPhones);
      }
      
      if (validPhones.length === 0) {
        throw new Error('No valid phone numbers found in file');
      }
      
      // Create processing chunks
      const CHUNK_SIZE = service === 'blooio' ? 500 : 1000;
      const processingChunks = [];
      
      for (let i = 0; i < validPhones.length; i += CHUNK_SIZE) {
        const chunkPhones = validPhones.slice(i, i + CHUNK_SIZE);
        processingChunks.push({
          file_id: fileId,
          chunk_offset: i,
          chunk_data: JSON.stringify(chunkPhones),
          chunk_status: 'pending'
        });
      }
      
      console.log(`✓ Creating ${processingChunks.length} processing chunks...`);
      
      // Insert processing chunks
      if (processingChunks.length > 0) {
        const values = processingChunks.map(chunk => 
          `(${chunk.file_id}, ${chunk.chunk_offset}, ${connection.escape(chunk.chunk_data)}, '${chunk.chunk_status}')`
        ).join(',');
        
        await connection.execute(
          `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
           VALUES ${values}`
        );
        
        console.log(`✓ ${processingChunks.length} processing chunks created`);
      }
      
      // Update file record
      await connection.execute(
        `UPDATE uploaded_files 
         SET upload_status = 'completed',
             processing_status = 'initialized',
             processing_total = ?,
             processing_offset = 0,
             processing_progress = 0
         WHERE id = ?`,
        [validPhones.length, fileId]
      );
      
      console.log(`✓ File record updated`);
      
      // Clean up upload chunks (NOW it's safe to delete)
      await connection.execute(
        `DELETE FROM file_chunks WHERE file_id = ?`,
        [fileId]
      );
      
      console.log(`✓ Upload chunks cleaned up`);
      console.log(`✅ File ${fileId} ready for processing with ${validPhones.length} phones\n`);
      
      return NextResponse.json({
        success: true,
        uploadId: fileId,
        chunkIndex: chunkIndex,
        complete: true,
        totalRecords: validPhones.length,
        invalidRecords: invalidPhones.length,
        processingChunks: processingChunks.length,
        message: 'Upload complete and processing chunks created'
      });
    }
    
    // Not all chunks received yet
    const progress = ((file[0].chunks_received / file[0].chunk_count) * 100).toFixed(1);
    
    return NextResponse.json({
      success: true,
      uploadId: fileId,
      chunkIndex: chunkIndex,
      complete: false,
      progress: progress,
      chunksReceived: file[0].chunks_received,
      totalChunks: file[0].chunk_count
    });
    
  } catch (error) {
    console.error('Chunk upload error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}