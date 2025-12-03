import { NextResponse } from 'next/server';
import { savePhoneCheck, getCachedPhoneCheck } from '../../../lib/db.js';

const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';
const RATE_LIMIT_DELAY = parseInt(process.env.RATE_LIMIT_DELAY_MS) || 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPhoneNumber(phone) {
  let formatted = phone.toString().trim().replace(/[^\d+]/g, '');
  
  if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }
  
  return formatted;
}

function isValidE164(phone) {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

function validatePhoneNumber(phone) {
  const formatted = formatPhoneNumber(phone);
  
  if (!isValidE164(formatted)) {
    return { valid: false, error: 'Invalid E.164 format', formatted };
  }
  
  const digits = formatted.substring(1);
  if (digits.length < 7 || digits.length > 15) {
    return { valid: false, error: `Invalid length: ${digits.length} digits (must be 7-15)`, formatted };
  }
  
  return { valid: true, formatted };
}

async function checkSingleNumberWithCache(phoneNumber, batchId) {
  const validation = validatePhoneNumber(phoneNumber);
  
  if (!validation.valid) {
    return {
      phone_number: phoneNumber,
      formatted_number: validation.formatted,
      error: validation.error,
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'validation_error'
    };
  }
  
  const formattedPhone = validation.formatted;
  
  // STEP 1: Check cache first (within 6 months)
  try {
    const cachedResult = await getCachedPhoneCheck(formattedPhone);
    
    if (cachedResult) {
      // Return cached result
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
        batch_id: batchId // Add to current batch
      };
    }
  } catch (cacheError) {
    console.error(`Cache check error for ${formattedPhone}:`, cacheError);
    // Continue to API call if cache fails
  }
  
  // STEP 2: Not in cache or expired - check via API
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
    const { phones, batchId } = await request.json();
    
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json(
        { error: 'Phone numbers array is required' },
        { status: 400 }
      );
    }
    
    console.log(`Starting batch: ${phones.length} numbers, batch ID: ${batchId}`);
    
    const results = [];
    const total = phones.length;
    let cacheHits = 0;
    let apiCalls = 0;
    
    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];
      
      // Check with cache
      const result = await checkSingleNumberWithCache(phone, batchId);
      
      // Track statistics
      if (result.from_cache) {
        cacheHits++;
      } else if (result.source === 'api') {
        apiCalls++;
      }
      
      // Save to database (update or insert)
      try {
        await savePhoneCheck(result);
      } catch (dbError) {
        console.error('Database save error:', dbError);
        result.db_error = 'Failed to save to database';
      }
      
      results.push(result);
      
      const status = result.from_cache ? 'CACHE' : result.error ? 'ERROR' : 'API';
      console.log(`[${i + 1}/${total}] ${phone} - ${status}${result.from_cache ? ` (${result.cache_age_days}d old)` : ''}`);
      
      // Rate limiting only for API calls (not cached results)
      if (!result.from_cache && i < phones.length - 1) {
        await delay(RATE_LIMIT_DELAY);
      }
    }
    
    console.log(`Batch complete: ${cacheHits} from cache, ${apiCalls} API calls, ${results.filter(r => r.error).length} errors`);
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      total_processed: results.length,
      cache_hits: cacheHits,
      api_calls: apiCalls,
      total_success: results.filter(r => !r.error).length,
      total_errors: results.filter(r => r.error).length,
      api_calls_saved: cacheHits,
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