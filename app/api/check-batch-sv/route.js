import { NextResponse } from 'next/server';
import { 
  saveUploadedFile, 
  updateFileStatus,
  updateFileResultsURL
} from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import { uploadFile, uploadResultsAsCSV } from '../../../lib/blobStorage.js';
import { checkBulkInBatches, categorizeBulkResults } from '../../../lib/subscriberVerify.js';
import Papa from 'papaparse';

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
    
    console.log(`Starting SubscriberVerify batch: ${fileName}, batch ID: ${batchId}`);
    
    // Upload original file to Vercel Blob
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
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
    
    // Validate and format US phone numbers
    const validationResult = processPhoneArray(phones);
    
    console.log(`Validation: ${validationResult.stats.valid} valid US numbers`);
    
    // Save file metadata
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
    
    const startTime = Date.now();
    
    // Convert to 10-digit format for SubscriberVerify
    const svPhones = validationResult.valid.map(v => v.formatted.replace(/^\+?1/, ''));
    
    console.log(`Checking ${svPhones.length} numbers with SubscriberVerify bulk API...`);
    
    // Bulk check with SubscriberVerify
    const svBulkResults = await checkBulkInBatches(svPhones);
    const categorized = categorizeBulkResults(svBulkResults);
    
    console.log(`SubscriberVerify results: send=${categorized.send.length}, unsubscribe=${categorized.unsubscribe.length}, blacklist=${categorized.blacklist.length}`);
    
    // Format results for CSV
    const results = svBulkResults.map((svResult, index) => {
      const validPhone = validationResult.valid[index];
      
      return {
        original_number: validPhone.original,
        formatted_number: validPhone.formatted,
        display_number: validPhone.display,
        action: svResult.action,
        reason: svResult.reason || '',
        deliverable: svResult.action === 'send',
        carrier: svResult.dipCarrier || svResult.nanpCarrier || '',
        carrier_type: svResult.dipCarrierType || svResult.nanpType || '',
        is_mobile: (svResult.dipCarrierType === 'mobile' || svResult.nanpType === 'mobile'),
        litigator: svResult.litigator || false,
        blacklisted: svResult.blackList || false,
        geo_state: svResult.geoState || '',
        geo_city: svResult.geoCity || '',
        timezone: svResult.timezone || '',
        checked_at: new Date().toISOString()
      };
    });
    
    // Upload results CSV
    const csv = Papa.unparse(results);
    const resultsFileName = `${fileName.replace('.csv', '')}_sv_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
    
    await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size);
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates,
      sv_send_count: categorized.send.length,
      sv_unsubscribe_count: categorized.unsubscribe.length,
      sv_blacklist_count: categorized.blacklist.length
    });
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`SubscriberVerify batch complete: ${totalTime}s total`);
    
    return NextResponse.json({
      success: true,
      service: 'subscriberverify',
      batch_id: batchId,
      file_id: fileId,
      original_file_url: originalFileBlob.url,
      results_file_url: resultsBlob.url,
      validation: validationResult.stats,
      subscriber_verify_stats: {
        send: categorized.send.length,
        unsubscribe: categorized.unsubscribe.length,
        blacklist: categorized.blacklist.length,
        error: categorized.error.length
      },
      total_processed: results.length,
      processing_time_seconds: parseFloat(totalTime),
      results: results
    });
    
  } catch (error) {
    console.error('SubscriberVerify batch error:', error);
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