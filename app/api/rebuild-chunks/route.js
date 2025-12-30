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
    
    // Get all original chunk data
    const [allChunks] = await pool.execute(
      `SELECT chunk_data 
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
    
    // ✅ DELETE ALL CHUNKS (we'll rebuild from scratch)
    await pool.execute(
      `DELETE FROM processing_chunks WHERE file_id = ?`,
      [fileId]
    );
    
    console.log(`   Cleared all old chunks`);
    
    // Collect all phones from all chunks
    let allPhones = [];
    
    for (const chunk of allChunks) {
      try {
        const phones = JSON.parse(chunk.chunk_data);
        allPhones.push(...phones);
      } catch (e) {
        console.error('Failed to parse chunk:', e);
      }
    }
    
    console.log(`   Total phones in chunks: ${allPhones.length}`);
    
    // Filter out already processed phones
    const unprocessedPhones = allPhones.filter(p => !processedSet.has(p.e164));
    
    console.log(`   Unprocessed phones: ${unprocessedPhones.length}`);
    
    // Create new chunks with ONLY unprocessed phones
    const CHUNK_SIZE = 500;
    let chunkCount = 0;
    
    for (let i = 0; i < unprocessedPhones.length; i += CHUNK_SIZE) {
      const chunkPhones = unprocessedPhones.slice(i, i + CHUNK_SIZE);
      
      await pool.execute(
        `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
         VALUES (?, ?, ?, 'pending')`,
        [
          fileId,
          i,  // Fresh offset starting from 0
          JSON.stringify(chunkPhones)
        ]
      );
      
      chunkCount++;
      
      if (chunkCount % 100 === 0) {
        console.log(`   Created ${chunkCount} chunks...`);
      }
    }
    
    console.log(`✅ Created ${chunkCount} new chunks`);
    
    // Update file status
    const [file] = await pool.execute(
      `SELECT processing_total FROM uploaded_files WHERE id = ?`,
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
    
    console.log(`✅ File offset set to ${alreadyProcessed} / ${total} (${(alreadyProcessed/total*100).toFixed(2)}%)`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      alreadyProcessed: alreadyProcessed,
      totalPhones: total,
      remaining: unprocessedPhones.length,
      newChunks: chunkCount,
      progress: (alreadyProcessed / total * 100).toFixed(2) + '%'
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