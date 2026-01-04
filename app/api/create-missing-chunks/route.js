import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { parsePhoneNumber } from 'libphonenumber-js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId required' }, { status: 400 });
    }
    
    console.log(`🔧 Creating chunks from CSV for file ${fileId}...`);
    
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
    
    // Get processed phones
    const [processedPhones] = await pool.execute(
      `SELECT DISTINCT e164 FROM blooio_results WHERE file_id = ?`,
      [fileId]
    );
    
    const processedSet = new Set(processedPhones.map(p => p.e164));
    console.log(`   Already processed: ${processedSet.size} phones`);
    
    // Load CSV
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, file.file_name);
    
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ 
        success: false, 
        error: `CSV file not found at ${filePath}` 
      }, { status: 404 });
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`   Total records in CSV: ${records.length}`);
    
    // Parse all phones from CSV
    const allPhones = [];
    const seenE164 = new Set();
    
    for (const record of records) {
      const phoneColumn = Object.keys(record)[0];
      const rawPhone = record[phoneColumn];
      
      if (!rawPhone) continue;
      
      try {
        const parsed = parsePhoneNumber(rawPhone, 'US');
        if (parsed && parsed.isValid()) {
          const e164 = parsed.format('E.164');
          
          // Deduplicate within CSV
          if (!seenE164.has(e164)) {
            seenE164.add(e164);
            allPhones.push({
              original: rawPhone,
              e164: e164
            });
          }
        }
      } catch (error) {
        // Skip invalid phones
      }
    }
    
    console.log(`   Unique valid phones in CSV: ${allPhones.length}`);
    
    // Find unprocessed phones
    const unprocessedPhones = allPhones.filter(p => !processedSet.has(p.e164));
    
    console.log(`   Unprocessed phones: ${unprocessedPhones.length}`);
    
    if (unprocessedPhones.length === 0) {
      // Mark file as complete
      await pool.execute(
        `UPDATE uploaded_files 
         SET processing_status = 'completed',
             processing_progress = 100
         WHERE id = ?`,
        [fileId]
      );
      
      return NextResponse.json({
        success: true,
        message: 'All phones processed!',
        totalInCSV: allPhones.length,
        processed: processedSet.size,
        unprocessed: 0
      });
    }
    
    // Create chunks
    const CHUNK_SIZE = 500;
    let chunkCount = 0;
    
    for (let i = 0; i < unprocessedPhones.length; i += CHUNK_SIZE) {
      const chunkPhones = unprocessedPhones.slice(i, i + CHUNK_SIZE);
      
      await pool.execute(
        `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
         VALUES (?, ?, ?, 'pending')`,
        [
          fileId,
          i, // Clean sequential offset
          JSON.stringify(chunkPhones)
        ]
      );
      
      chunkCount++;
    }
    
    console.log(`✅ Created ${chunkCount} chunks for ${unprocessedPhones.length} unprocessed phones`);
    
    // Resume processing
    await pool.execute(
      `UPDATE uploaded_files 
       SET processing_status = 'processing'
       WHERE id = ?`,
      [fileId]
    );
    
    return NextResponse.json({
      success: true,
      totalInCSV: allPhones.length,
      alreadyProcessed: processedSet.size,
      unprocessed: unprocessedPhones.length,
      chunksCreated: chunkCount
    });
    
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}