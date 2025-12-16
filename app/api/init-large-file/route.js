import { NextResponse } from 'next/server';
import { saveUploadedFile, addToQueue } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import Papa from 'papaparse';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName');
    const service = formData.get('service');
    
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }
    
    console.log(`Initializing large file: ${fileName} for ${service} service`);
    
    // Upload original
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
    console.log(`Uploaded to blob: ${originalFileBlob.url}`);
    
    // Parse and validate
    const fileText = await file.text();
    const parseResult = Papa.parse(fileText, { header: true, skipEmptyLines: true });
    
    const phoneColumn = findPhoneColumn(parseResult.data);
    if (!phoneColumn) {
      return NextResponse.json(
        { error: 'Could not find phone number column' },
        { status: 400 }
      );
    }
    
    const phones = parseResult.data
      .map(row => row[phoneColumn])
      .filter(phone => phone && phone.toString().trim());
    
    if (phones.length === 0) {
      return NextResponse.json(
        { error: 'No phone numbers found' },
        { status: 400 }
      );
    }
    
    console.log(`Found ${phones.length} phone numbers`);
    
    const validationResult = processPhoneArray(phones);
    const batchId = `batch_${Date.now()}`;
    
    console.log(`Validated: ${validationResult.stats.valid} valid numbers`);
    
    // Store processing state
    const processingState = JSON.stringify({
      validPhones: validationResult.valid,
      batchId: batchId,
      fileName: fileName,
      service: service
    });
    
    const stateSizeKB = (processingState.length / 1024).toFixed(2);
    console.log(`Processing state size: ${stateSizeKB} KB`);
    
    // Calculate chunk size and estimated time based on service
    let chunkSize, estimatedChunks, estimatedTimeMinutes;
    
    if (service === 'blooio') {
      chunkSize = 200;
      estimatedChunks = Math.ceil(validationResult.stats.valid / chunkSize);
      estimatedTimeMinutes = Math.ceil(estimatedChunks * 1);
    } else {
      chunkSize = 5000;
      estimatedChunks = Math.ceil(validationResult.stats.valid / chunkSize);
      estimatedTimeMinutes = Math.ceil(estimatedChunks * 0.25);
    }
    
    // Save to database
    const fileId = await saveUploadedFile({
      file_name: fileName,
      original_name: fileName,
      file_size: file.size,
      total_numbers: validationResult.stats.total,
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates,
      batch_id: batchId,
      processing_status: 'initialized',
      processing_offset: 0,
      processing_total: validationResult.stats.valid,
      processing_progress: 0,
      processing_state: processingState,
      can_resume: true,
      original_file_url: originalFileBlob.url,
      original_file_size: originalFileBlob.size
    });
    
    //console.log(`File initialized with ID: ${fileId}`);
    console.log(`✓ File saved with ID: ${fileId}`);
    await addToQueue(fileId, 0);
    console.log('=== INIT COMPLETE ===');
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      service: service,
      totalRecords: validationResult.stats.valid,
      chunkSize: chunkSize,
      estimatedChunks: estimatedChunks,
      estimatedTime: `${estimatedTimeMinutes} minutes`
    });
    
  } catch (error) {
    console.error('Init large file error:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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