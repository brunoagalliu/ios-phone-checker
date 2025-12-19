// Blooio API configuration - Multiple keys for parallel processing
const BLOOIO_API_BASE = process.env.BLOOIO_API_URL || 'https://backend.blooio.com/v1/api/contacts';

// Load all available API keys
const API_KEYS = [
  process.env.BLOOIO_API_KEY_1,
  process.env.BLOOIO_API_KEY_2,
  process.env.BLOOIO_API_KEY_3,
  process.env.BLOOIO_API_KEY_4,
  process.env.BLOOIO_API_KEY, // Fallback to single key if old var exists
].filter(key => key); // Remove undefined keys

console.log(`✓ Loaded ${API_KEYS.length} Blooio API key(s)`);

// Rate limiter class (one per API key)
class RateLimiter {
  constructor(requestsPerSecond) {
    this.delay = 1000 / requestsPerSecond;
    this.lastCall = 0;
  }

  async acquire() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    
    if (timeSinceLastCall < this.delay) {
      await new Promise(resolve => setTimeout(resolve, this.delay - timeSinceLastCall));
    }
    
    this.lastCall = Date.now();
  }
}

// Create one rate limiter per API key
const rateLimiters = API_KEYS.map(() => new RateLimiter(4));

// Round-robin key selector
let currentKeyIndex = 0;

function getNextApiKey() {
  if (API_KEYS.length === 0) {
    throw new Error('No Blooio API keys configured');
  }
  
  const key = API_KEYS[currentKeyIndex];
  const limiter = rateLimiters[currentKeyIndex];
  
  // Rotate to next key
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  
  return { key, limiter };
}

// Export for backward compatibility (uses first key)
export const blooioRateLimiter = rateLimiters[0];

/**
 * Check a single phone number via Blooio API
 * Automatically rotates through available API keys
 */
export async function checkBlooioSingle(phoneNumber) {
  // Validate configuration
  if (!BLOOIO_API_BASE) {
    console.error('❌ BLOOIO_API_URL environment variable is not set');
    throw new Error('BLOOIO_API_URL is not defined');
  }
  
  if (API_KEYS.length === 0) {
    console.error('❌ No Blooio API keys configured');
    throw new Error('No Blooio API keys available');
  }
  
  // Get next API key and its rate limiter
  const { key, limiter } = getNextApiKey();
  
  // Wait for rate limiter
  await limiter.acquire();
  
  try {
    // URL encode the phone number (+ becomes %2B)
    const encodedPhone = encodeURIComponent(phoneNumber);
    
    // Build full API URL
    const apiUrl = `${BLOOIO_API_BASE}/${encodedPhone}/capabilities`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
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
 * Get API key statistics
 */
export function getApiKeyStats() {
  return {
    totalKeys: API_KEYS.length,
    effectiveRate: API_KEYS.length * 4, // requests per second
    currentKeyIndex: currentKeyIndex
  };
}