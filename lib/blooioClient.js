// Blooio API configuration
const BLOOIO_API_BASE = process.env.BLOOIO_API_URL || 'https://backend.blooio.com/v2/api/contacts';
const BLOOIO_API_KEY = process.env.BLOOIO_API_KEY;

// Batch rate limiter - allows 4 requests per second in batches
class BatchRateLimiter {
  constructor(requestsPerSecond) {
    this.requestsPerSecond = requestsPerSecond;
    this.batchDelay = 1000; // 1 second between batches
    this.lastBatchTime = 0;
  }

  async acquireBatch(batchSize) {
    // Ensure we don't exceed rate limit
    if (batchSize > this.requestsPerSecond) {
      throw new Error(`Batch size ${batchSize} exceeds rate limit of ${this.requestsPerSecond}`);
    }

    const now = Date.now();
    const timeSinceLastBatch = now - this.lastBatchTime;
    
    // Wait if we need to respect the rate limit
    if (timeSinceLastBatch < this.batchDelay) {
      const waitTime = this.batchDelay - timeSinceLastBatch;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastBatchTime = Date.now();
  }
}

export const blooioRateLimiter = new BatchRateLimiter(4);

/**
 * Check a single phone number via Blooio API
 */
export async function checkBlooioSingle(phoneNumber) {
  // Validate configuration
  if (!BLOOIO_API_BASE) {
    console.error('❌ BLOOIO_API_URL environment variable is not set');
    throw new Error('BLOOIO_API_URL is not defined');
  }
  
  if (!BLOOIO_API_KEY) {
    console.error('❌ BLOOIO_API_KEY environment variable is not set');
    throw new Error('BLOOIO_API_KEY is not defined');
  }
  
  try {
    // URL encode the phone number
    const encodedPhone = encodeURIComponent(phoneNumber);
    const apiUrl = `${BLOOIO_API_BASE}/${encodedPhone}/capabilities`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${BLOOIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Blooio API HTTP error: ${response.status}`, errorText);
      
      return {
        is_ios: null,
        supports_imessage: null,
        supports_sms: null,
        contact_type: null,
        contact_id: null,
        error: `HTTP ${response.status}: ${errorText}`
      };
    }
    
    const data = await response.json();
    
    // Parse Blooio response
    const result = {
      is_ios: Boolean(
        data.is_ios || 
        data.isIOS || 
        data.ios || 
        data.capabilities?.ios
      ),
      supports_imessage: Boolean(
        data.supports_imessage || 
        data.imessage || 
        data.iMessage || 
        data.capabilities?.imessage ||
        data.capabilities?.iMessage
      ),
      supports_sms: Boolean(
        data.supports_sms || 
        data.sms || 
        data.capabilities?.sms
      ),
      contact_type: data.contact_type || data.contactType || data.type || null,
      contact_id: data.contact_id || data.contactId || data.id || null,
      error: null
    };
    
    return result;
    
  } catch (error) {
    console.error('Blooio API request failed:', error);
    
    return {
      is_ios: null,
      supports_imessage: null,
      supports_sms: null,
      contact_type: null,
      contact_id: null,
      error: error.message
    };
  }
}

/**
 * Process multiple phones in parallel (respecting rate limits)
 */
export async function checkBlooioBatch(phones, batchSize = 4) {
  const results = [];
  
  // Process in batches of up to 4
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    
    // Wait for rate limiter
    await blooioRateLimiter.acquireBatch(batch.length);
    
    // Process entire batch in parallel
    const batchPromises = batch.map(phone => checkBlooioSingle(phone));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
  }
  
  return results;
}