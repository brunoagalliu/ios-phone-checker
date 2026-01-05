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
import { getBlooioCache, saveBlooioCache } from '../../../lib/phoneCache.js';
import Papa from 'papaparse';

export const maxDuration = 300;
const BLOOIO_API_URL = 'https://backend.blooio.com/v2/api/contacts';

async function checkSingleNumberWithCache(phoneNumber, batchId, fileId) {
  const formattedPhone = `+${phoneNumber}`;
  
  // Check unified cache first
  try {
    const cachedResult = await getBlooioCache(formattedPhone);
    
    if (cachedResult) {
      cachedResult.batch_id = batchId;
      return cachedResult;
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
      
      const resultData = {
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
      
      // Save to unified cache (fire and forget)
      saveBlooioCache(resultData).catch(err => 
        console.error('Failed to save to cache:', err)
      );
      
      return resultData;
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
    
    console.log(`Validation complete: ${validationResult.stats.valid} valid, ${validationResult.stats.invalid} invalid, ${validationResult.stats.duplicates} duplicates`);
    
    // Save file metadata to database
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
    
    // Process only valid phone numbers with Blooio
    for (let i = 0; i < validationResult.valid.length; i++) {
      const validPhone = validationResult.valid[i];
      
      // Check with cache and Blooio API (rate limited)
      const result = await checkSingleNumberWithCache(
        validPhone.formatted, 
        batchId, 
        fileId
      );
      
      // Track statistics
      if (result.from_cache) {
        cacheHits++;
      } else if (result.source === 'api') {
        apiCalls++;
      }
      
      // Add original and formatted info
      result.original_number = validPhone.original;
      result.formatted_number = validPhone.formatted;
      result.display_number = validPhone.display;
      
      // Save to database
      try {
        await savePhoneCheckWithFile(result, fileId);
      } catch (dbError) {
        console.error('Database save error:', dbError);
        result.db_error = 'Failed to save to database';
      }
      
      results.push(result);
      
      const status = result.from_cache ? 'CACHE' : result.error ? 'ERROR' : 'API';
      const progress = `[${i + 1}/${validationResult.valid.length}]`;
      console.log(`${progress} ${validPhone.formatted} - ${status}`);
      
      // Log rate limiter stats every 10 requests
      if ((i + 1) % 10 === 0) {
        const stats = blooioRateLimiter.getStats();
        console.log(`Rate limiter: ${stats.timeSinceLastRequest}ms since last request`);
      }
    }
    
    // Upload results CSV to Blob Storage
    const csv = Papa.unparse(results.map(r => ({
      original_number: r.original_number || r.phone_number,
      formatted_number: r.formatted_number || r.phone_number,
      display_number: r.display_number || r.phone_number,
      is_ios: r.is_ios ? 'YES' : 'NO',
      supports_imessage: r.supports_imessage ? 'YES' : 'NO',
      supports_sms: r.supports_sms ? 'YES' : 'NO',
      from_cache: r.from_cache ? 'YES' : 'NO',
      cache_age_days: r.cache_age_days || 'N/A',
      error: r.error || 'None',
      checked_at: new Date().toISOString()
    })));
    
    const resultsFileName = `${fileName.replace('.csv', '')}_blooio_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
    
    console.log(`Results uploaded to: ${resultsBlob.url}`);
    
    // Update file with results URL
    await updateFileResultsURL(fileId, resultsBlob.url, resultsBlob.size);
    
    // Update file status to completed
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates
    });
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgTimePerRequest = validationResult.valid.length > 0 
      ? ((Date.now() - startTime) / validationResult.valid.length / 1000).toFixed(2)
      : 0;
    
    console.log(`Blooio batch complete: ${cacheHits} from cache, ${apiCalls} API calls, ${totalTime}s total, ${avgTimePerRequest}s avg per request`);
    
    return NextResponse.json({
      success: true,
      service: 'blooio',
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
      avg_time_per_request: parseFloat(avgTimePerRequest),
      rate_limit_info: {
        requests_per_second: 4,
        time_between_requests_ms: 250
      },
      results: results
    });
    
  } catch (error) {
    console.error('Blooio batch check error:', error);
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