import { NextResponse } from 'next/server';
import { 
  savePhoneCheckWithFile, 
  getCachedPhoneCheck, 
  saveUploadedFile, 
  updateFileStatus,
  updateFileResultsURL
} from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import blooioRateLimiter from '../../../lib/rateLimiter.js';
import { uploadFile, uploadResultsAsCSV } from '../../../lib/blobStorage.js';

const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

// ... (keep existing checkSingleNumberWithCache function)

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const batchId = formData.get('batchId');
    const fileName = formData.get('fileName');
    
    if (!file) {
      return NextResponse.json(
        { error: 'File is required' },
        { status: 400 }
      );
    }
    
    console.log(`Starting batch: ${fileName}, batch ID: ${batchId}`);
    
    // STEP 1: Upload original file to Vercel Blob
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
    console.log(`Original file uploaded to: ${originalFileBlob.url}`);
    
    // STEP 2: Parse CSV content
    const fileText = await file.text();
    const Papa = require('papaparse');
    const parseResult = Papa.parse(fileText, {
      header: true,
      skipEmptyLines: true
    });
    
    // Extract phone numbers
    const phones = [];
    const phoneColumn = findPhoneColumn(parseResult.data);
    
    if (!phoneColumn) {
      return NextResponse.json(
        { error: 'Could not find phone number column' },
        { status: 400 }
      );
    }
    
    parseResult.data.forEach(row => {
      const phone = row[phoneColumn];
      if (phone) {
        phones.push(phone.toString().trim());
      }
    });
    
    if (phones.length === 0) {
      return NextResponse.json(
        { error: 'No phone numbers found' },
        { status: 400 }
      );
    }
    
    // STEP 3: Validate and format
    const validationResult = processPhoneArray(phones);
    
    console.log(`Validation complete: ${validationResult.stats.valid} valid`);
    
    // STEP 4: Save file metadata to database
    const fileId = await saveUploadedFile({
      file_name: fileName,
      original_name: fileName,
      file_size: file.size,
      total_numbers: validationResult.stats.total,
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates,
      batch_id: batchId,
      processing_status: 'processing',
      original_file_url: originalFileBlob.url,
      original_file_size: originalFileBlob.size
    });
    
    const results = [];
    let cacheHits = 0;
    let apiCalls = 0;
    const startTime = Date.now();
    
    // STEP 5: Process valid phone numbers
    for (let i = 0; i < validationResult.valid.length; i++) {
      const validPhone = validationResult.valid[i];
      
      const result = await checkSingleNumberWithCache(
        validPhone.formatted, 
        batchId, 
        fileId
      );
      
      if (result.from_cache) {
        cacheHits++;
      } else if (result.source === 'api') {
        apiCalls++;
      }
      
      result.original_number = validPhone.original;
      result.formatted_number = validPhone.formatted;
      result.display_number = validPhone.display;
      
      try {
        await savePhoneCheckWithFile(result, fileId);
      } catch (dbError) {
        console.error('Database save error:', dbError);
        result.db_error = 'Failed to save to database';
      }
      
      results.push(result);
      
      const status = result.from_cache ? 'CACHE' : result.error ? 'ERROR' : 'API';
      console.log(`[${i + 1}/${validationResult.valid.length}] ${validPhone.formatted} - ${status}`);
    }
    
    // STEP 6: Upload results CSV to Blob Storage
    const resultsFileName = `${fileName.replace('.csv', '')}_results_${Date.now()}.csv`;
    const resultsBlob = await uploadResultsAsCSV(results, resultsFileName);
    
    console.log(`Results uploaded to: ${resultsBlob.url}`);
    
    // STEP 7: Update file with results URL
    await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size);
    
    // STEP 8: Update file status to completed
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates
    });
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`Batch complete: ${totalTime}s total`);
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      file_id: fileId,
      original_file_url: originalFileBlob.url,
      results_file_url: resultsBlob.url,
      validation: validationResult.stats,
      invalid_numbers: validationResult.invalid,
      total_processed: results.length,
      cache_hits: cacheHits,
      api_calls: apiCalls,
      total_success: results.filter(r => !r.error).length,
      total_errors: results.filter(r => r.error).length,
      api_calls_saved: cacheHits,
      processing_time_seconds: parseFloat(totalTime),
      results: results
    });
    
  } catch (error) {
    console.error('Batch check error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
  );
  }
}

function findPhoneColumn(data) {
  if (data.length === 0) return null;
  
  const firstRow = data[0];
  const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'cell', 'telephone'];
  
  for (const col of Object.keys(firstRow)) {
    const lowerCol = col.toLowerCase().trim();
    if (possibleColumns.includes(lowerCol)) {
      return col;
    }
  }
  
  return Object.keys(firstRow)[0];
}