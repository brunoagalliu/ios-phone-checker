import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId required' }, { status: 400 });
    }
    
    console.log(`🔧 Creating missing chunks for file ${fileId}...`);
    
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
    console.log(`   File total: ${file.processing_total} phones`);
    console.log(`   File offset: ${file.processing_offset} phones`);
    
    // Get all processed phone numbers
    const [processedPhones] = await pool.execute(
      `SELECT DISTINCT e164 FROM blooio_results WHERE file_id = ?`,
      [fileId]
    );
    
    const processedSet = new Set(processedPhones.map(p => p.e164));
    console.log(`   Already processed: ${processedSet.size} phones`);
    
    // Get all existing chunks
    const [allChunks] = await pool.execute(
      `SELECT chunk_data FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset ASC`,
      [fileId]
    );
    
    console.log(`   Existing chunks: ${allChunks.length}`);
    
    // Extract all phones from all chunks
    const allPhones = [];
    
    for (const chunk of allChunks) {
      try {
        const phones = JSON.parse(chunk.chunk_data);
        allPhones.push(...phones);
      } catch (e) {
        console.error('Failed to parse chunk:', e);
      }
    }
    
    console.log(`   Total phones in chunks: ${allPhones.length}`);
    
    // Find unprocessed phones
    const unprocessedPhones = allPhones.filter(phone => !processedSet.has(phone.e164));
    
    console.log(`   Unprocessed phones: ${unprocessedPhones.length}`);
    
    if (unprocessedPhones.length === 0) {
      console.log('✅ No unprocessed phones found - all caught up!');
      
      // Check if we need to mark file as complete
      if (file.processing_offset >= file.processing_total) {
        await pool.execute(
          `UPDATE uploaded_files 
           SET processing_status = 'completed',
               processing_progress = 100
           WHERE id = ?`,
          [fileId]
        );
        console.log('✅ File marked as completed');
      }
      
      return NextResponse.json({
        success: true,
        message: 'No missing phones - all processed',
        totalPhones: allPhones.length,
        processed: processedSet.size,
        unprocessed: 0
      });
    }
    
    // Delete old pending chunks (we'll recreate them properly)
    await pool.execute(
      `DELETE FROM processing_chunks 
       WHERE file_id = ? 
       AND chunk_status = 'pending'`,
      [fileId]
    );
    
    console.log('   Cleared old pending chunks');
    
    // Create new chunks for unprocessed phones
    const CHUNK_SIZE = 500;
    let chunkCount = 0;
    const startingOffset = 500000; // High offset to avoid conflicts
    
    for (let i = 0; i < unprocessedPhones.length; i += CHUNK_SIZE) {
      const chunkPhones = unprocessedPhones.slice(i, i + CHUNK_SIZE);
      
      await pool.execute(
        `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
         VALUES (?, ?, ?, 'pending')`,
        [
          fileId,
          startingOffset + i,
          JSON.stringify(chunkPhones)
        ]
      );
      
      chunkCount++;
      
      if (chunkCount % 50 === 0) {
        console.log(`   Created ${chunkCount} chunks...`);
      }
    }
    
    console.log(`✅ Created ${chunkCount} new chunks for ${unprocessedPhones.length} unprocessed phones`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      totalPhonesInChunks: allPhones.length,
      alreadyProcessed: processedSet.size,
      unprocessed: unprocessedPhones.length,
      chunksCreated: chunkCount
    });
    
  } catch (error) {
    console.error('Create missing chunks error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}