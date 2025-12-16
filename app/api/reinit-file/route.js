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
    
    console.log(`Reinitializing file ${fileId}...`);
    
    const connection = await getConnection();
    
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    
    if (!file.original_file_url) {
      return NextResponse.json({ 
        error: 'No original file URL. File must be re-uploaded.' 
      }, { status: 400 });
    }
    
    console.log('Downloading file from blob...');
    const response = await fetch(file.original_file_url);
    const fileText = await response.text();
    
    const parseResult = Papa.parse(fileText, { 
      header: true, 
      skipEmptyLines: true 
    });
    
    const phoneColumn = findPhoneColumn(parseResult.data);
    const phones = parseResult.data
      .map(row => row[phoneColumn])
      .filter(phone => phone && phone.toString().trim());
    
    const validationResult = processPhoneArray(phones);
    
    const processingState = JSON.stringify({
      validPhones: validationResult.valid,
      batchId: file.batch_id,
      fileName: file.original_name,
      service: 'blooio'
    });
    
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
    
    console.log(`File ${fileId} reinitialized`);
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      service: 'blooio',
      totalRecords: validationResult.stats.valid,
      chunkSize: 200,
      estimatedChunks: Math.ceil(validationResult.stats.valid / 200)
    });
    
  } catch (error) {
    console.error('Reinit error:', error);
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 });
  }
}

function findPhoneColumn(data) {
  if (!data || data.length === 0) return null;
  const firstRow = data[0];
  const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number'];
  
  for (const col of Object.keys(firstRow)) {
    if (possibleColumns.includes(col.toLowerCase().trim())) {
      return col;
    }
  }
  
  return Object.keys(firstRow)[0];
}