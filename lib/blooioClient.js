// ✅ DEFINE CONSTANTS AT THE TOP, OUTSIDE FUNCTIONS
const BLOOIO_API_URL = process.env.BLOOIO_API_URL;
const BLOOIO_API_KEY = process.env.BLOOIO_API_KEY;

// Rate limiter class
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

export const blooioRateLimiter = new RateLimiter(4); // 4 requests per second

/**
 * Check a single phone number via Blooio API
 */
export async function checkBlooioSingle(phoneNumber) {
  // Validate configuration
  if (!BLOOIO_API_URL) {
    console.error('❌ BLOOIO_API_URL environment variable is not set');
    throw new Error('BLOOIO_API_URL is not defined');
  }
  
  if (!BLOOIO_API_KEY) {
    console.error('❌ BLOOIO_API_KEY environment variable is not set');
    throw new Error('BLOOIO_API_KEY is not defined');
  }
  
  try {
    console.log(`Calling Blooio API for: ${phoneNumber}`);
    console.log(`Using API URL: ${BLOOIO_API_URL}`);
    
    const response = await fetch(BLOOIO_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BLOOIO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        phone: phoneNumber 
      })
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
    console.log('Blooio response:', data);
    
    // Check for API-level errors
    if (data.error) {
      console.error('Blooio API returned error:', data.error);
      return {
        is_ios: null,
        supports_imessage: null,
        supports_sms: null,
        contact_type: null,
        contact_id: null,
        error: data.error
      };
    }
    
    // Parse and return result
    // Note: Adjust field names based on actual Blooio API response format
    return {
      is_ios: Boolean(data.is_ios),
      supports_imessage: Boolean(data.supports_imessage),
      supports_sms: Boolean(data.supports_sms),
      contact_type: data.contact_type || null,
      contact_id: data.contact_id || null,
      error: null
    };
    
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