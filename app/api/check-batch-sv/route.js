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
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
    console.log(`Original file uploaded to: ${originalFileBlob.url}`);
    
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
    fileId = await saveUploadedFile({
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
    
    console.log(`File saved to database with ID: ${fileId}`);
    
    const startTime = Date.now();
    
    // Convert to 10-digit format for SubscriberVerify (remove +1)
    const svPhones = validationResult.valid.map(v => v.formatted.replace(/^\+?1/, ''));
    
    console.log(`Checking ${svPhones.length} numbers with SubscriberVerify bulk API...`);
    
    // Bulk check with SubscriberVerify
    const svBulkResults = await checkBulkInBatches(svPhones);
    
    console.log(`SubscriberVerify returned ${svBulkResults.length} results`);
    
    const categorized = categorizeBulkResults(svBulkResults);
    
    console.log(`SubscriberVerify categorized: send=${categorized.send.length}, unsubscribe=${categorized.unsubscribe.length}, blacklist=${categorized.blacklist.length}, error=${categorized.error.length}`);
    
    // Format results for CSV
    const results = svBulkResults.map((svResult, index) => {
      const validPhone = validationResult.valid[index];
      
      return {
        original_number: validPhone.original,
        formatted_number: validPhone.formatted,
        display_number: validPhone.display,
        action: svResult.action || 'unknown',
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
    
    console.log(`Formatted ${results.length} results for CSV`);
    
    // Upload results CSV
    const csv = Papa.unparse(results);
    const resultsFileName = `${fileName.replace('.csv', '')}_sv_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
    
    console.log(`Results uploaded to: ${resultsBlob.url}`);
    
    await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size);
    console.log(`File results URL updated in database`);
    
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates,
      sv_send_count: categorized.send.length,
      sv_unsubscribe_count: categorized.unsubscribe.length,
      sv_blacklist_count: categorized.blacklist.length
    });
    
    console.log(`File status updated to completed`);
    
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
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
      },
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