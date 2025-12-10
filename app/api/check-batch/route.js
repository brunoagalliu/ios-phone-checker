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
import { checkBulkInBatches, categorizeBulkResults } from '../../../lib/subscriberVerify.js';

const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

async function checkSingleNumberWithCache(phoneNumber, batchId, fileId, subscriberVerifyData = null) {
  const formattedPhone = `+${phoneNumber}`;
  
  // Check cache first
  try {
    const cachedResult = await getCachedPhoneCheck(formattedPhone);
    
    if (cachedResult) {
      return {
        phone_number: formattedPhone,
        is_ios: cachedResult.is_ios,
        supports_imessage: cachedResult.supports_imessage,
        supports_sms: cachedResult.supports_sms,
        contact_type: cachedResult.contact_type,
        contact_id: cachedResult.contact_id,
        error: cachedResult.error,
        from_cache: true,
        cache_age_days: cachedResult.cache_age_days,
        last_checked: cachedResult.last_checked,
        check_count: cachedResult.check_count,
        source: 'cache',
        batch_id: batchId,
        sv_data: subscriberVerifyData
      };
    }
  } catch (cacheError) {
    console.error(`Cache check error for ${formattedPhone}:`, cacheError);
  }
  
  // Not in cache - check via Blooio API with rate limiting
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    return {
      phone_number: formattedPhone,
      error: 'Blooio API key not configured',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'config_error',
      sv_data: subscriberVerifyData
    };
  }
  
  try {
    console.log(`Blooio API call for: ${formattedPhone}`);
    
    const result = await blooioRateLimiter.execute(async () => {
      const response = await fetch(
        `${BLOOIO_API_URL}/${encodeURIComponent(formattedPhone)}/capabilities`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(30000)
        }
      );
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
          
          if (response.status === 503 && errorMessage.includes('No active devices')) {
            errorMessage = 'Blooio: No active devices available';
          }
        } catch (e) {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
        }
        
        if (response.status === 401) errorMessage = 'Invalid API key';
        if (response.status === 403) errorMessage = 'API access forbidden';
        if (response.status === 404) errorMessage = 'Phone number not found';
        if (response.status === 429) errorMessage = 'Rate limit exceeded';
        
        return {
          phone_number: formattedPhone,
          error: errorMessage,
          is_ios: false,
          supports_imessage: false,
          supports_sms: false,
          from_cache: false,
          source: 'api_error',
          sv_data: subscriberVerifyData
        };
      }
      
      const data = await response.json();
      const capabilities = data.capabilities || {};
      const supportsIMessage = capabilities.imessage === true || capabilities.iMessage === true;
      const supportsSMS = capabilities.sms === true || capabilities.SMS === true;
      
      return {
        phone_number: formattedPhone,
        contact_id: data.contact,
        contact_type: data.contact_type,
        is_ios: supportsIMessage,
        supports_imessage: supportsIMessage,
        supports_sms: supportsSMS,
        last_checked_at: data.last_checked_at,
        error: null,
        from_cache: false,
        source: 'api',
        batch_id: batchId,
        sv_data: subscriberVerifyData
      };
    });
    
    return result;
    
  } catch (error) {
    console.error(`Error checking ${formattedPhone}:`, error);
    
    let errorMessage = error.message;
    
    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout (30s exceeded)';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Network error';
    }
    
    return {
      phone_number: formattedPhone,
      error: errorMessage,
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'network_error',
      sv_data: subscriberVerifyData
    };
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const batchId = formData.get('batchId');
    const fileName = formData.get('fileName');
    const useSubscriberVerify = formData.get('useSubscriberVerify') === 'true';
    
    if (!file) {
      return NextResponse.json(
        { error: 'File is required' },
        { status: 400 }
      );
    }
    
    console.log(`Starting batch: ${fileName}, batch ID: ${batchId}, SV: ${useSubscriberVerify}`);
    
    // Upload original file to Vercel Blob
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalFileBlob = await uploadFile(fileBuffer, fileName, 'originals');
    
    // Parse CSV
    const fileText = await file.text();
    const Papa = require('papaparse');
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
    
    // Validate and format
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
    
    const results = [];
    let cacheHits = 0;
    let apiCalls = 0;
    let svFiltered = 0;
    const startTime = Date.now();
    
    let phonesToCheck = validationResult.valid;
    let svResults = null;
    
    // STAGE 1: SubscriberVerify bulk check (if enabled)
    if (useSubscriberVerify) {
      console.log('STAGE 1: SubscriberVerify bulk validation...');
      
      const svPhones = validationResult.valid.map(v => v.formatted.replace('+', ''));
      
      try {
        const svBulkResults = await checkBulkInBatches(svPhones);
        const categorized = categorizeBulkResults(svBulkResults);
        
        console.log(`SubscriberVerify results: ${categorized.send.length} sendable, ${categorized.unsubscribe.length} invalid, ${categorized.blacklist.length} blacklisted`);
        
        // Only check iOS for "send" category (valid mobile numbers)
        phonesToCheck = categorized.send.map(cat => validationResult.valid[cat.index]);
        svFiltered = validationResult.valid.length - phonesToCheck.length;
        
        // Store SV results
        svResults = svBulkResults;
        
        // Add non-sendable numbers to results immediately
        [...categorized.unsubscribe, ...categorized.blacklist, ...categorized.error].forEach(cat => {
          const validPhone = validationResult.valid[cat.index];
          results.push({
            phone_number: `+${validPhone.formatted}`,
            original_number: validPhone.original,
            formatted_number: validPhone.formatted,
            display_number: validPhone.display,
            is_ios: false,
            supports_imessage: false,
            supports_sms: false,
            error: cat.reason || `SubscriberVerify: ${cat.action}`,
            from_cache: false,
            source: 'subscriber_verify_filtered',
            sv_data: cat
          });
        });
        
      } catch (svError) {
        console.error('SubscriberVerify error:', svError);
        // Continue without SV filtering
      }
    }
    
    // STAGE 2: iOS detection via Blooio (only for valid mobile numbers)
    console.log(`STAGE 2: Checking ${phonesToCheck.length} numbers for iOS...`);
    
    for (let i = 0; i < phonesToCheck.length; i++) {
      const validPhone = phonesToCheck[i];
      const originalIndex = validationResult.valid.findIndex(v => v.formatted === validPhone.formatted);
      const svData = svResults ? svResults[originalIndex] : null;
      
      const result = await checkSingleNumberWithCache(
        validPhone.formatted,
        batchId,
        fileId,
        svData
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
      console.log(`[${i + 1}/${phonesToCheck.length}] ${validPhone.formatted} - ${status}`);
    }
    
    // Upload results CSV
    const resultsFileName = `${fileName.replace('.csv', '')}_results_${Date.now()}.csv`;
    const resultsBlob = await uploadResultsAsCSV(results, resultsFileName);
    
    await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size);
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates
    });
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`Batch complete: ${totalTime}s, ${svFiltered} filtered by SV, ${apiCalls} Blooio API calls`);
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      file_id: fileId,
      original_file_url: originalFileBlob.url,
      results_file_url: resultsBlob.url,
      validation: validationResult.stats,
      subscriber_verify_filtered: svFiltered,
      invalid_numbers: validationResult.invalid,
      total_processed: results.length,
      cache_hits: cacheHits,
      api_calls: apiCalls,
      total_success: results.filter(r => !r.error).length,
      total_errors: results.filter(r => r.error).length,
      api_calls_saved: cacheHits + svFiltered,
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