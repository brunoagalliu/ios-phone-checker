import { NextResponse } from 'next/server';
import { 
  saveUploadedFile, 
  updateFileStatus,
  updateFileResultsURL
} from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { checkBulkInBatches, categorizeBulkResults } from '../../../lib/subscriberVerify.js';
import Papa from 'papaparse';

export async function POST(request) {
  let fileId = null;
  
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
    
    console.log(`Starting SubscriberVerify batch: ${fileName}, batch ID: ${batchId}`);
    
    // Upload original file to Vercel Blob
    let originalFileBlob = null;
    try {
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
      console.log(`Original file uploaded to: ${originalFileBlob?.url || 'null'}`);
    } catch (uploadError) {
      console.error('File upload error:', uploadError);
      originalFileBlob = { url: null, size: 0 };
    }
    
    // Parse CSV
    const fileText = await file.text();
    const parseResult = Papa.parse(fileText, {
      header: true,
      skipEmptyLines: true
    });
    
    const phones = [];
    const phoneColumn = findPhoneColumn(parseResult.data);
    
    if (!phoneColumn) {
      return NextResponse.json(
        { error: 'Could not find phone number column. Please ensure your CSV has a column named "phone", "phone_number", "mobile", or "number"' },
        { status: 400 }
      );
    }
    
    console.log(`Found phone column: ${phoneColumn}`);
    
    parseResult.data.forEach(row => {
      const phone = row[phoneColumn];
      if (phone && phone.toString().trim()) {
        phones.push(phone.toString().trim());
      }
    });
    
    if (phones.length === 0) {
      return NextResponse.json(
        { error: 'No phone numbers found in the CSV file' },
        { status: 400 }
      );
    }
    
    console.log(`Extracted ${phones.length} phone numbers from CSV`);
    
    // Validate and format US phone numbers
    const validationResult = processPhoneArray(phones);
    
    console.log(`Validation results:`, {
      total: validationResult.stats.total,
      valid: validationResult.stats.valid,
      invalid: validationResult.stats.invalid,
      duplicates: validationResult.stats.duplicates,
      blank: validationResult.stats.blank
    });
    
    // Save file metadata to database
    fileId = await saveUploadedFile({
      file_name: fileName || 'unknown.csv',
      original_name: fileName || 'unknown.csv',
      file_size: file.size || 0,
      total_numbers: validationResult.stats.total || 0,
      valid_numbers: validationResult.stats.valid || 0,
      invalid_numbers: validationResult.stats.invalid || 0,
      duplicate_numbers: validationResult.stats.duplicates || 0,
      batch_id: batchId || null,
      processing_status: 'processing',
      original_file_url: originalFileBlob?.url || null,
      original_file_size: originalFileBlob?.size || 0,
      storage_path: null
    });
    
    console.log(`File saved to database with ID: ${fileId}`);
    
    const startTime = Date.now();
    
    // Convert to 10-digit format for SubscriberVerify (remove +1 prefix)
    const svPhones = validationResult.valid.map(v => {
      // Remove +1 prefix if present
      return v.formatted.replace(/^\+?1/, '');
    });
    
    console.log(`Prepared ${svPhones.length} numbers for SubscriberVerify (10-digit format)`);
    console.log(`Sample numbers:`, svPhones.slice(0, 3));
    
    // Bulk check with SubscriberVerify
    console.log('Calling SubscriberVerify bulk API...');
    const svBulkResults = await checkBulkInBatches(svPhones);
    
    console.log(`SubscriberVerify returned ${svBulkResults.length} results`);
    
    // Categorize results
    const categorized = categorizeBulkResults(svBulkResults);
    
    console.log(`SubscriberVerify categorized:`, {
      send: categorized.send.length,
      unsubscribe: categorized.unsubscribe.length,
      blacklist: categorized.blacklist.length,
      error: categorized.error.length
    });
    
    // Format results for CSV
    const results = svBulkResults.map((svResult, index) => {
      const validPhone = validationResult.valid[index];
      
      return {
        original_number: validPhone?.original || '',
        formatted_number: validPhone?.formatted || '',
        display_number: validPhone?.display || '',
        action: svResult?.action || 'unknown',
        reason: svResult?.reason || '',
        deliverable: svResult?.action === 'send',
        carrier: svResult?.dipCarrier || svResult?.nanpCarrier || '',
        carrier_type: svResult?.dipCarrierType || svResult?.nanpType || '',
        is_mobile: (svResult?.dipCarrierType === 'mobile' || svResult?.nanpType === 'mobile'),
        litigator: svResult?.litigator || false,
        blacklisted: svResult?.blackList || false,
        geo_state: svResult?.geoState || '',
        geo_city: svResult?.geoCity || '',
        timezone: svResult?.timezone || '',
        checked_at: new Date().toISOString()
      };
    });
    
    console.log(`Formatted ${results.length} results for CSV export`);
    
    // Create CSV content
    const csv = Papa.unparse(results);
    console.log(`Generated CSV content, size: ${csv.length} bytes`);
    
    // Upload results CSV to Blob Storage
    let resultsBlob = null;
    try {
      const resultsFileName = `${fileName.replace('.csv', '')}_sv_results_${Date.now()}.csv`;
      resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
      console.log(`Results uploaded to: ${resultsBlob?.url || 'null'}`);
    } catch (resultsUploadError) {
      console.error('Results upload error:', resultsUploadError);
      resultsBlob = { url: null, size: csv.length };
    }
    
    // Update file with results URL (only if we have a URL)
    if (resultsBlob?.url) {
      await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size || 0);
      console.log(`File results URL updated in database`);
    } else {
      console.warn('No results blob URL to update');
    }
    
    // Update file status to completed
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid || 0,
      invalid_numbers: validationResult.stats.invalid || 0,
      duplicate_numbers: validationResult.stats.duplicates || 0,
      sv_send_count: categorized.send?.length || 0,
      sv_unsubscribe_count: categorized.unsubscribe?.length || 0,
      sv_blacklist_count: categorized.blacklist?.length || 0
    });
    
    console.log(`File status updated to completed`);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`SubscriberVerify batch complete: ${totalTime}s total`);
    
    return NextResponse.json({
      success: true,
      service: 'subscriberverify',
      batch_id: batchId,
      file_id: fileId,
      original_file_url: originalFileBlob?.url || null,
      results_file_url: resultsBlob?.url || null,
      validation: validationResult.stats,
      subscriber_verify_stats: {
        send: categorized.send?.length || 0,
        unsubscribe: categorized.unsubscribe?.length || 0,
        blacklist: categorized.blacklist?.length || 0,
        error: categorized.error?.length || 0
      },
      total_processed: results.length,
      processing_time_seconds: parseFloat(totalTime),
      results: results
    });
    
  } catch (error) {
    console.error('SubscriberVerify batch error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Mark file as failed if we have a fileId
    if (fileId) {
      try {
        await updateFileStatus(fileId, 'failed');
        console.log(`Marked file ${fileId} as failed`);
      } catch (updateError) {
        console.error('Failed to update file status:', updateError);
      }
    }
    
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

function findPhoneColumn(data) {
  if (!data || data.length === 0) return null;
  
  const firstRow = data[0];
  if (!firstRow) return null;
  
  const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'cell', 'telephone'];
  
  // Try to find exact match first
  for (const col of Object.keys(firstRow)) {
    const lowerCol = col.toLowerCase().trim();
    if (possibleColumns.includes(lowerCol)) {
      return col;
    }
  }
  
  // Fallback: return first column that looks like it might contain phone numbers
  for (const col of Object.keys(firstRow)) {
    const value = firstRow[col];
    if (value && /\d{3,}/.test(value.toString())) {
      console.log(`Using column '${col}' as phone column (fallback)`);
      return col;
    }
  }
  
  // Last resort: return first column
  const firstColumn = Object.keys(firstRow)[0];
  console.log(`Using first column '${firstColumn}' as phone column (last resort)`);
  return firstColumn;
}