import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import Papa from 'papaparse';

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    console.log(`Reinitializing file ${fileId} for chunked processing...`);
    
    const connection = await getConnection();
    
    // Get file
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    console.log('File found:', file.file_name);
    
    // Download original file from blob
    if (!file.original_file_url) {
      return NextResponse.json({ 
        error: 'No original file URL. File must be re-uploaded.' 
      }, { status: 400 });
    }
    
    console.log('Downloading original file from:', file.original_file_url);
    
    const response = await fetch(file.original_file_url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    
    const fileText = await response.text();
    console.log(`Downloaded ${fileText.length} bytes`);
    
    // Parse CSV
    const parseResult = Papa.parse(fileText, { 
      header: true, 
      skipEmptyLines: true 
    });
    
    console.log(`Parsed ${parseResult.data.length} rows`);
    
    // Find phone column
    const phoneColumn = findPhoneColumn(parseResult.data);
    if (!phoneColumn) {
      return NextResponse.json({ 
        error: 'Could not find phone column' 
      }, { status: 400 });
    }
    
    console.log(`Using phone column: ${phoneColumn}`);
    
    // Extract phones
    const phones = parseResult.data
      .map(row => row[phoneColumn])
      .filter(phone => phone && phone.toString().trim());
    
    console.log(`Extracted ${phones.length} phone numbers`);
    
    // Validate
    const validationResult = processPhoneArray(phones);
    
    console.log('Validation results:', {
      total: validationResult.stats.total,
      valid: validationResult.stats.valid,
      invalid: validationResult.stats.invalid
    });
    
    // Determine service - default to blooio, or check if it was SV
    let service = 'blooio';
    
    // Check if there are any SV-specific columns in the results
    const [existingChecks] = await connection.execute(
      'SELECT * FROM phone_checks WHERE batch_id = ? LIMIT 1',
      [file.batch_id]
    );
    
    if (existingChecks.length > 0) {
      // Check if this looks like a blooio result
      const check = existingChecks[0];
      if (check.contact_id !== null || check.contact_type !== null) {
        service = 'blooio';
        console.log('Detected Blooio service from existing checks');
      } else {
        service = 'subscriberverify';
        console.log('Detected SubscriberVerify service from existing checks');
      }
    }
    
    // Create processing state
    const processingState = JSON.stringify({
      validPhones: validationResult.valid,
      batchId: file.batch_id,
      fileName: file.original_name,
      service: service
    });
    
    // Update file for chunked processing
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_state = ?,
           processing_status = 'initialized',
           processing_offset = 0,
           processing_total = ?,
           processing_progress = 0,
           can_resume = TRUE
       WHERE id = ?`,
      [processingState, validationResult.stats.valid, fileId]
    );
    
    console.log(`✓ File ${fileId} reinitialized for chunked processing (${service})`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      service: service,
      totalRecords: validationResult.stats.valid,
      chunkSize: service === 'blooio' ? 200 : 5000,
      estimatedChunks: Math.ceil(validationResult.stats.valid / (service === 'blooio' ? 200 : 5000)),
      message: `File reinitialized for ${service} chunked processing. You can now use the chunked processor.`
    });
    
  } catch (error) {
    console.error('Reinit error:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

function findPhoneColumn(data) {
  if (!data || data.length === 0) return null;
  const firstRow = data[0];
  const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'cell', 'telephone'];
  
  for (const col of Object.keys(firstRow)) {
    if (possibleColumns.includes(col.toLowerCase().trim())) {
      return col;
    }
  }
  
  return Object.keys(firstRow)[0];
}