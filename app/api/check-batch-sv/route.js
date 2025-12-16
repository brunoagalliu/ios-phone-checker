import { NextResponse } from 'next/server';
import { 
  savePhoneCheckWithFile, 
  saveUploadedFile, 
  updateFileStatus,
  updateFileResultsURL
} from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import blooioRateLimiter from '../../../lib/rateLimiter.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { getBlooioCacheBatch, saveBlooioCacheBatch } from '../../../lib/phoneCache.js';
import Papa from 'papaparse';

export const maxDuration = 300;
const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

async function checkSingleNumberWithAPI(phoneNumber, batchId) {
  const formattedPhone = `+${phoneNumber}`;
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    return {
      phone_number: formattedPhone,
      error: 'Blooio API key not configured',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'config_error'
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
          source: 'api_error'
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
        batch_id: batchId
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
      source: 'network_error'
    };
  }
}

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
    
    console.log(`Starting Blooio batch: ${fileName}, batch ID: ${batchId}`);
    
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
    
    // BATCH CACHE LOOKUP - ONE QUERY INSTEAD OF THOUSANDS!
    console.log(`Batch checking Blooio cache for ${validationResult.valid.length} numbers...`);
    const cacheCheckStart = Date.now();
    
    // Prepare phone numbers for batch lookup (with +1 prefix)
    const formattedPhones = validationResult.valid.map(v => `+${v.formatted}`);
    
    // Batch cache lookup
    const blooioCacheMap = await getBlooioCacheBatch(formattedPhones);
    
    const cacheCheckTime = ((Date.now() - cacheCheckStart) / 1000).toFixed(2);
    console.log(`Blooio batch cache check: ${blooioCacheMap.size} hits out of ${formattedPhones.length} in ${cacheCheckTime}s`);
    
    const results = [];
    let cacheHits = 0;
    let apiCalls = 0;
    const uncachedData = [];
    
    // Process each number
    for (let i = 0; i < validationResult.valid.length; i++) {
      const validPhone = validationResult.valid[i];
      const formattedPhone = `+${validPhone.formatted}`;
      
      // Check batch cache first
      const cachedResult = blooioCacheMap.get(formattedPhone);
      
      if (cachedResult) {
        // Use cached result
        cacheHits++;
        cachedResult.batch_id = batchId;
        cachedResult.original_number = validPhone.original;
        cachedResult.formatted_number = validPhone.formatted;
        cachedResult.display_number = validPhone.display;
        
        await savePhoneCheckWithFile(cachedResult, fileId);
        results.push(cachedResult);
        
        console.log(`[${i + 1}/${validationResult.valid.length}] ${validPhone.formatted} - CACHE HIT (${cachedResult.cache_age_days}d old)`);
      } else {
        // Need to call API
        const result = await checkSingleNumberWithAPI(validPhone.formatted, batchId);
        
        if (!result.from_cache && result.source === 'api') {
          apiCalls++;
          uncachedData.push(result);
        }
        
        result.original_number = validPhone.original;
        result.formatted_number = validPhone.formatted;
        result.display_number = validPhone.display;
        
        await savePhoneCheckWithFile(result, fileId);
        results.push(result);
        
        const status = result.error ? `ERROR: ${result.error}` : `API - iOS: ${result.is_ios}`;
        console.log(`[${i + 1}/${validationResult.valid.length}] ${validPhone.formatted} - ${status}`);
      }
      
      // Update progress in database every 10 records
      if ((i + 1) % 10 === 0 || i === validationResult.valid.length - 1) {
        await updateFileStatus(fileId, 'processing', {
          valid_numbers: validationResult.stats.valid,
          invalid_numbers: validationResult.stats.invalid,
          duplicate_numbers: validationResult.stats.duplicates
        });
      }
    }
    
    // BATCH SAVE NEW API RESULTS TO CACHE - ONE QUERY INSTEAD OF THOUSANDS!
    if (uncachedData.length > 0) {
      console.log(`Batch saving ${uncachedData.length} new results to cache...`);
      const cacheSaveStart = Date.now();
      
      await saveBlooioCacheBatch(uncachedData);
      
      const cacheSaveTime = ((Date.now() - cacheSaveStart) / 1000).toFixed(2);
      console.log(`Batch cache save completed in ${cacheSaveTime}s`);
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`Blooio batch complete: ${totalTime}s total, ${cacheHits} from cache, ${apiCalls} API calls`);
    
    // Generate results CSV
    const csv = Papa.unparse(results.map(r => ({
      original_number: r.original_number,
      formatted_number: r.formatted_number,
      display_number: r.display_number,
      phone_number: r.phone_number,
      is_ios: r.is_ios ? 'YES' : 'NO',
      supports_imessage: r.supports_imessage ? 'YES' : 'NO',
      supports_sms: r.supports_sms ? 'YES' : 'NO',
      contact_type: r.contact_type || '',
      contact_id: r.contact_id || '',
      from_cache: r.from_cache ? 'YES' : 'NO',
      cache_age_days: r.cache_age_days || '',
      error: r.error || 'None',
      checked_at: r.last_checked_at || new Date().toISOString()
    })));
    
    // Upload results CSV to Blob Storage
    let resultsBlob = null;
    try {
      const resultsFileName = `${fileName.replace('.csv', '')}_blooio_results_${Date.now()}.csv`;
      resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
      console.log(`Results uploaded to: ${resultsBlob?.url || 'null'}`);
    } catch (resultsUploadError) {
      console.error('Results upload error:', resultsUploadError);
      resultsBlob = { url: null, size: csv.length };
    }
    
    // Update file with results URL
    if (resultsBlob?.url) {
      await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size || 0);
      console.log(`File results URL updated in database`);
    } else {
      console.warn('No results blob URL to update');
    }
    
    // Count iOS devices
    const iosCount = results.filter(r => r.is_ios).length;
    const errorCount = results.filter(r => r.error && r.error !== 'None').length;
    
    // Update file status to completed
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates
    });
    
    console.log(`File status updated to completed`);
    
    return NextResponse.json({
      success: true,
      service: 'blooio',
      batch_id: batchId,
      file_id: fileId,
      original_file_url: originalFileBlob?.url || null,
      results_file_url: resultsBlob?.url || null,
      validation: validationResult.stats,
      ios_count: iosCount,
      error_count: errorCount,
      cache_hits: cacheHits,
      api_calls: apiCalls,
      api_calls_saved: cacheHits,
      total_processed: results.length,
      processing_time_seconds: parseFloat(totalTime),
      results: results
    });
    
  } catch (error) {
    console.error('Blooio batch error:', error);
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