import { NextResponse } from 'next/server';
import { 
  savePhoneCheckWithFile, 
  getCachedPhoneCheck, 
  saveUploadedFile, 
  updateFileStatus 
} from '../../../lib/db.js';
import { processPhoneArray } from '../../../lib/phoneValidator.js';
import blooioRateLimiter from '../../../lib/rateLimiter.js';

const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

async function checkSingleNumberWithCache(phoneNumber, batchId, fileId) {
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
        batch_id: batchId
      };
    }
  } catch (cacheError) {
    console.error(`Cache check error for ${formattedPhone}:`, cacheError);
  }
  
  // Not in cache - check via API with rate limiting
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    return {
      phone_number: formattedPhone,
      error: 'Server configuration error: API key not set',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'config_error'
    };
  }
  
  try {
    console.log(`API call for: ${formattedPhone}`);
    
    // Use rate limiter to execute the API call
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
  try {
    const { phones, batchId, fileName } = await request.json();
    
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json(
        { error: 'Phone numbers array is required' },
        { status: 400 }
      );
    }
    
    console.log(`Starting batch: ${phones.length} numbers, batch ID: ${batchId}`);
    console.log(`Rate limiter: 4 requests/second (250ms between requests)`);
    
    // STEP 1: Validate and format all phone numbers
    const validationResult = processPhoneArray(phones);
    
    console.log(`Validation complete: ${validationResult.stats.valid} valid, ${validationResult.stats.invalid} invalid, ${validationResult.stats.duplicates} duplicates`);
    
    // STEP 2: Save file metadata to database
    const fileId = await saveUploadedFile({
      file_name: fileName || 'upload.csv',
      original_name: fileName || 'upload.csv',
      file_size: 0,
      total_numbers: validationResult.stats.total,
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates,
      batch_id: batchId,
      processing_status: 'processing'
    });
    
    const results = [];
    let cacheHits = 0;
    let apiCalls = 0;
    const startTime = Date.now();
    
    // STEP 3: Process only valid phone numbers with rate limiting
    for (let i = 0; i < validationResult.valid.length; i++) {
      const validPhone = validationResult.valid[i];
      
      // Check with cache and API (rate limited)
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
    
    // STEP 4: Update file status to completed
    await updateFileStatus(fileId, 'completed', {
      valid_numbers: validationResult.stats.valid,
      invalid_numbers: validationResult.stats.invalid,
      duplicate_numbers: validationResult.stats.duplicates
    });
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgTimePerRequest = validationResult.valid.length > 0 
      ? ((Date.now() - startTime) / validationResult.valid.length / 1000).toFixed(2)
      : 0;
    
    console.log(`Batch complete: ${cacheHits} from cache, ${apiCalls} API calls, ${totalTime}s total, ${avgTimePerRequest}s avg per request`);
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      file_id: fileId,
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
    console.error('Batch check error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}