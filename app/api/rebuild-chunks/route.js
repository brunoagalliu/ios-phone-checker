import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({
        success: false,
        error: 'fileId required'
      }, { status: 400 });
    }
    
    console.log(`🔄 Rebuilding chunks for file ${fileId}...`);
    
    const pool = await getConnection();
    
    // Get all chunks
    const [allChunks] = await pool.execute(
      `SELECT id, chunk_offset, chunk_data, chunk_status
       FROM processing_chunks
       WHERE file_id = ?
       ORDER BY chunk_offset ASC`,
      [fileId]
    );
    
    console.log(`   Found ${allChunks.length} total chunks`);
    
    // Get all processed phone numbers
    const [processedPhones] = await pool.execute(
      `SELECT DISTINCT e164 FROM blooio_results WHERE file_id = ?`,
      [fileId]
    );
    
    const processedSet = new Set(processedPhones.map(p => p.e164));
    console.log(`   ${processedSet.size} phones already processed`);
    
    // Clear existing pending/failed chunks
    await pool.execute(
      `DELETE FROM processing_chunks 
       WHERE file_id = ? 
       AND chunk_status IN ('pending', 'failed', 'processing')`,
      [fileId]
    );
    
    console.log(`   Cleared old pending/failed chunks`);
    
    // Rebuild chunks with only unprocessed phones
    let newChunks = [];
    let unprocessedPhones = [];
    
    for (const chunk of allChunks) {
      if (chunk.chunk_status !== 'completed') continue;
      
      const phones = JSON.parse(chunk.chunk_data);
      
      // Filter out already processed phones
      const remainingPhones = phones.filter(p => !processedSet.has(p.e164));
      
      if (remainingPhones.length > 0) {
        unprocessedPhones.push(...remainingPhones);
      }
    }
    
    console.log(`   Found ${unprocessedPhones.length} unprocessed phones`);
    
    // Create new chunks with unprocessed phones
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
    }
    
    console.log(`✅ Created ${chunkCount} new chunks for unprocessed phones`);
    
    // Update file status
    const [file] = await pool.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    const alreadyProcessed = processedSet.size;
    const total = file[0].processing_total;
    
    await pool.execute(
      `UPDATE uploaded_files
       SET processing_offset = ?,
           processing_progress = ROUND(? / ? * 100, 2),
           processing_status = 'processing'
       WHERE id = ?`,
      [alreadyProcessed, alreadyProcessed, total, fileId]
    );
    
    console.log(`✅ File offset set to ${alreadyProcessed} (${(alreadyProcessed/total*100).toFixed(2)}%)`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      alreadyProcessed: alreadyProcessed,
      remaining: unprocessedPhones.length,
      newChunks: chunkCount,
      progress: (alreadyProcessed / total * 100).toFixed(2)
    });
    
  } catch (error) {
    console.error('Rebuild chunks error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}