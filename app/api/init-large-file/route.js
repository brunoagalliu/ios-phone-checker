import { NextResponse } from 'next/server';
import { saveUploadedFile } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import Papa from 'papaparse';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName');
    const service = formData.get('service');
    
    // Upload original
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
    // Parse and validate
    const fileText = await file.text();
    const parseResult = Papa.parse(fileText, { header: true, skipEmptyLines: true });
    
    const phoneColumn = findPhoneColumn(parseResult.data);
    const phones = parseResult.data.map(row => row[phoneColumn]).filter(Boolean);
    
    const validationResult = processPhoneArray(phones);
    const batchId = `batch_${Date.now()}`;
    
    // Store processing state
    const processingState = JSON.stringify({
      validPhones: validationResult.valid,
      batchId: batchId,
      fileName: fileName,
      service: service
    });
    
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
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      totalRecords: validationResult.stats.valid,
      chunkSize: 5000,
      estimatedChunks: Math.ceil(validationResult.stats.valid / 5000),
      estimatedTime: Math.ceil(validationResult.stats.valid / 5000) + ' minutes'
    });
    
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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