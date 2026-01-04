import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId required' }, { status: 400 });
    }
    
    console.log(`🔧 Rebuilding chunks for file ${fileId}...`);
    
    const pool = await getConnection();
    
    // Get file info
    const [files] = await pool.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    console.log(`   File expects: ${file.processing_total} phones`);
    
    // Get all processed phones
    const [processedPhones] = await pool.execute(
      `SELECT DISTINCT e164 FROM blooio_results WHERE file_id = ?`,
      [fileId]
    );
    
    const processedSet = new Set(processedPhones.map(p => p.e164));
    console.log(`   Already processed: ${processedSet.size} phones`);
    
    // Get all chunks
    const [allChunks] = await pool.execute(
      `SELECT chunk_data FROM processing_chunks WHERE file_id = ?`,
      [fileId]
    );
    
    console.log(`   Existing chunks: ${allChunks.length}`);
    
    // Extract ALL unique phones from chunks (deduplicating)
    const uniquePhones = new Map(); // e164 -> phone object
    
    for (const chunk of allChunks) {
      try {
        const phones = JSON.parse(chunk.chunk_data);
        for (const phone of phones) {
          if (!uniquePhones.has(phone.e164)) {
            uniquePhones.set(phone.e164, phone);
          }
        }
      } catch (e) {
        console.error('Failed to parse chunk:', e);
      }
    }
    
    console.log(`   Unique phones in chunks: ${uniquePhones.size}`);
    
    // Find unprocessed phones
    const unprocessedPhones = [];
    for (const [e164, phone] of uniquePhones) {
      if (!processedSet.has(e164)) {
        unprocessedPhones.push(phone);
      }
    }
    
    console.log(`   Unprocessed phones: ${unprocessedPhones.length}`);
    
    if (unprocessedPhones.length === 0) {
      console.log('✅ All phones processed!');
      
      // Delete all chunks
      await pool.execute(
        `DELETE FROM processing_chunks WHERE file_id = ?`,
        [fileId]
      );
      
      // Mark file as complete
      await pool.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100,
             processing_offset = ?
         WHERE id = ?`,
        [processedSet.size, fileId]
      );
      
      return NextResponse.json({
        success: true,
        message: 'All phones processed - file marked complete',
        uniquePhonesFound: uniquePhones.size,
        processed: processedSet.size,
        unprocessed: 0
      });
    }
    
    // Delete ALL old chunks (they're duplicated)
    await pool.execute(
      `DELETE FROM processing_chunks WHERE file_id = ?`,
      [fileId]
    );
    
    console.log('   Deleted all old chunks');
    
    // Create clean chunks for unprocessed phones only
    const CHUNK_SIZE = 500;
    let chunkCount = 0;
    
    for (let i = 0; i < unprocessedPhones.length; i += CHUNK_SIZE) {
      const chunkPhones = unprocessedPhones.slice(i, i + CHUNK_SIZE);
      
      await pool.execute(
        `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
         VALUES (?, ?, ?, 'pending')`,
        [
          fileId,
          i,
          JSON.stringify(chunkPhones)
        ]
      );
      
      chunkCount++;
      
      if (chunkCount % 50 === 0) {
        console.log(`   Created ${chunkCount} chunks...`);
      }
    }
    
    console.log(`✅ Created ${chunkCount} clean chunks for ${unprocessedPhones.length} unprocessed phones`);
    
    // Resume processing
    await pool.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'processing'
       WHERE id = ?`,
      [fileId]
    );
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      uniquePhonesFound: uniquePhones.size,
      alreadyProcessed: processedSet.size,
      unprocessed: unprocessedPhones.length,
      chunksCreated: chunkCount,
      message: `Created ${chunkCount} clean chunks. Processing will resume automatically.`
    });
    
  } catch (error) {
    console.error('Rebuild chunks error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}