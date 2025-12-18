// Blooio API configuration
const BLOOIO_API_BASE = process.env.BLOOIO_API_URL || 'https://backend.blooio.com/v1/api/contacts';
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

export const blooioRateLimiter = new RateLimiter(4);

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
    // URL encode the phone number (+ becomes %2B)
    const encodedPhone = encodeURIComponent(phoneNumber);
    
    // Build full API URL
    const apiUrl = `${BLOOIO_API_BASE}/${encodedPhone}/capabilities`;
    
    console.log(`\n=== Blooio API Call ===`);
    console.log(`Phone: ${phoneNumber}`);
    console.log(`Encoded: ${encodedPhone}`);
    console.log(`Full URL: ${apiUrl}`); // ✅ Log the FULL URL
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${BLOOIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Response status: ${response.status}`);
    
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
    console.log('Blooio raw response:', JSON.stringify(data, null, 2));
    
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
    
    // Parse Blooio response - adjust field names based on actual response
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
    
    console.log('Parsed result:', result);
    console.log('===================\n');
    
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