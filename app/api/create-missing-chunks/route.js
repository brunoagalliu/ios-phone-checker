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
    
    // Get processed phone numbers
    const [processedPhones] = await pool.execute(
      `SELECT DISTINCT e164 FROM blooio_results WHERE file_id = ?`,
      [fileId]
    );
    
    const processedSet = new Set(processedPhones.map(p => p.e164));
    console.log(`   Already processed: ${processedSet.size} phones`);
    
    // Load CSV file
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, file.file_name);
    
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ 
        success: false, 
        error: 'CSV file not found - may have been cleaned up' 
      }, { status: 404 });
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`   Total phones in CSV: ${records.length}`);
    
    // Find unprocessed phones
    const unprocessedPhones = [];
    
    for (const record of records) {
      const phoneColumn = Object.keys(record)[0];
      const rawPhone = record[phoneColumn];
      
      if (!rawPhone) continue;
      
      try {
        const parsed = parsePhoneNumber(rawPhone, 'US');
        if (parsed && parsed.isValid()) {
          const e164 = parsed.format('E.164');
          
          if (!processedSet.has(e164)) {
            unprocessedPhones.push({
              original: rawPhone,
              e164: e164
            });
          }
        }
      } catch (error) {
        // Skip invalid phones
      }
    }
    
    console.log(`   Unprocessed phones: ${unprocessedPhones.length}`);
    
    if (unprocessedPhones.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No missing phones to process',
        unprocessed: 0
      });
    }
    
    // Create chunks for unprocessed phones
    const CHUNK_SIZE = 500;
    let chunkCount = 0;
    const startingOffset = 500000; // Use high offset to avoid conflicts
    
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
    
    console.log(`✅ Created ${chunkCount} new chunks for ${unprocessedPhones.length} phones`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      totalInFile: records.length,
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