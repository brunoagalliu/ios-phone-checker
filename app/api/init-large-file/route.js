import { NextResponse } from 'next/server';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  const pool = await getConnection(); // ✅ Get pool once
  
  try {
    const contentType = request.headers.get('content-type');
    
    // Handle chunked upload (JSON with fileId)
    if (contentType?.includes('application/json')) {
      const { fileId, service } = await request.json();
      
      console.log(`📋 Initializing chunked upload file ${fileId} for ${service}`);
      
      // Get file info
      const [files] = await pool.execute(
        `SELECT * FROM uploaded_files WHERE id = ?`,
        [fileId]
      );
      
      if (files.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'File not found'
        }, { status: 404 });
      }
      
      const file = files[0];
      
      if (file.upload_status !== 'completed') {
        return NextResponse.json({
          success: false,
          error: 'File upload not completed yet'
        }, { status: 400 });
      }
      
      console.log(`✓ File found: ${file.file_name}`);
      console.log(`✓ Records: ${file.processing_total}`);
      console.log(`✓ Service: ${file.service}`);
      
      // ✅ Fire-and-forget queue trigger (don't wait for response)
      try {
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : 'http://localhost:3000';
        
        console.log(`🔔 Triggering processing queue at ${baseUrl}/api/process-queue`);
        
        // Fire and forget - don't await
        fetch(`${baseUrl}/api/process-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).then(response => {
          if (response.ok) {
            console.log('✓ Queue triggered successfully');
          } else {
            console.warn(`⚠️ Queue returned status ${response.status}`);
          }
        }).catch(err => {
          console.warn('⚠️ Queue trigger failed (will be picked up by cron):', err.message);
        });
        
      } catch (triggerError) {
        console.warn('⚠️ Could not trigger queue (will be picked up by cron):', triggerError.message);
      }
      
      return NextResponse.json({
        success: true,
        fileId: fileId,
        totalRecords: file.processing_total,
        service: file.service,
        message: 'Processing started'
      });
    }
    
    // Handle direct upload (FormData with file)
    const formData = await request.formData();
    const file = formData.get('file');
    const service = formData.get('service') || 'blooio';
    
    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No file provided'
      }, { status: 400 });
    }
    
    console.log(`\n=== PROCESSING FILE ===`);
    console.log(`File: ${file.name}`);
    console.log(`Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Service: ${service}`);
    
    // Read file content
    const fileContent = await file.text();
    const lines = fileContent.trim().split('\n');
    
    if (lines.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'File must contain at least a header and one data row'
      }, { status: 400 });
    }
    
    const header = lines[0].trim();
    const dataLines = lines.slice(1);
    
    console.log(`Header: ${header}`);
    console.log(`Total lines: ${dataLines.length}`);
    
    // Validate and normalize phone numbers
    const validPhones = [];
    const invalidPhones = [];
    
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      let phoneNumber = parts[0].trim();
      
      try {
        if (!phoneNumber) {
          invalidPhones.push({ line: i + 2, phone: phoneNumber, reason: 'Empty' });
          continue;
        }
        
        // Clean the phone number
        let cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
        
        // Add country code if missing
        if (cleanedPhone.length === 10 && !cleanedPhone.startsWith('+')) {
          cleanedPhone = '+1' + cleanedPhone;
        } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('1') && !cleanedPhone.startsWith('+')) {
          cleanedPhone = '+' + cleanedPhone;
        } else if (!cleanedPhone.startsWith('+')) {
          cleanedPhone = '+' + cleanedPhone;
        }
        
        if (isValidPhoneNumber(cleanedPhone)) {
          const parsed = parsePhoneNumber(cleanedPhone);
          const e164 = parsed.format('E.164');
          validPhones.push({
            original: phoneNumber,
            e164: e164
          });
        } else {
          invalidPhones.push({ line: i + 2, phone: phoneNumber, reason: 'Invalid format' });
        }
      } catch (error) {
        invalidPhones.push({ line: i + 2, phone: phoneNumber, reason: error.message });
      }
    }
    
    console.log(`✓ Valid phones: ${validPhones.length}`);
    console.log(`✗ Invalid phones: ${invalidPhones.length}`);
    
    if (validPhones.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid phone numbers found in file',
        invalidCount: invalidPhones.length,
        invalidSamples: invalidPhones.slice(0, 10)
      }, { status: 400 });
    }
    
    // ✅ DEDUPLICATE PHONES
    const uniquePhones = [...new Map(
      validPhones.map(p => [p.e164, p])
    ).values()];
    
    console.log(`✓ Original phones: ${validPhones.length}`);
    console.log(`✓ Unique phones: ${uniquePhones.length}`);
    console.log(`✓ Duplicates removed: ${validPhones.length - uniquePhones.length}`);
    
    // Save to database
    const [result] = await pool.execute(
      `INSERT INTO uploaded_files 
       (file_name, upload_status, processing_status, service, 
        upload_date, processing_total, processing_offset, processing_progress)
       VALUES (?, 'completed', 'initialized', ?, NOW(), ?, 0, 0)`,
      [file.name, service, uniquePhones.length]
    );
    
    const fileId = result.insertId;
    
    console.log(`✓ File saved with ID: ${fileId}`);
    
    // Create processing chunks with UNIQUE phones
    const CHUNK_SIZE = service === 'blooio' ? 500 : 1000;
    const chunks = [];
    
    for (let i = 0; i < uniquePhones.length; i += CHUNK_SIZE) {
      const chunkPhones = uniquePhones.slice(i, i + CHUNK_SIZE);
      chunks.push({
        file_id: fileId,
        chunk_offset: i,
        chunk_data: JSON.stringify(chunkPhones),
        chunk_status: 'pending'
      });
    }
    
    console.log(`Creating ${chunks.length} processing chunks...`);
    
    // ✅ Batch insert chunks to prevent "packets out of order"
    if (chunks.length > 0) {
      const BATCH_SIZE = 100;
      let inserted = 0;
      
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        
        const values = batch.map(chunk => 
          `(${chunk.file_id}, ${chunk.chunk_offset}, ${pool.escape(chunk.chunk_data)}, '${chunk.chunk_status}')`
        ).join(',');
        
        await pool.execute(
          `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, chunk_status)
           VALUES ${values}`
        );
        
        inserted += batch.length;
        
        if ((i / BATCH_SIZE) % 5 === 0 || inserted === chunks.length) {
          console.log(`✓ Inserted ${inserted}/${chunks.length} processing chunks`);
        }
      }
      
      console.log(`✅ ${chunks.length} chunks created successfully`);
    }
    
    // ✅ Fire-and-forget queue trigger
    try {
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000';
      
      console.log(`🔔 Triggering processing queue...`);
      
      // Fire and forget - don't await
      fetch(`${baseUrl}/api/process-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).then(response => {
        if (response.ok) {
          console.log('✓ Queue triggered successfully');
        } else {
          console.warn(`⚠️ Queue returned status ${response.status}`);
        }
      }).catch(err => {
        console.warn('⚠️ Queue trigger failed (will be picked up by cron):', err.message);
      });
      
    } catch (triggerError) {
      console.warn('⚠️ Could not trigger queue:', triggerError.message);
    }
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      fileName: file.name,
      totalRecords: uniquePhones.length,
      duplicatesRemoved: validPhones.length - uniquePhones.length,
      invalidRecords: invalidPhones.length,
      chunks: chunks.length,
      service: service,
      message: `File initialized with ${uniquePhones.length} unique phone numbers`
    });
    
  } catch (error) {
    console.error('Init large file error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}