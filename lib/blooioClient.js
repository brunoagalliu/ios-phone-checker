/**
 * Blooio API Client with Rate Limiting
 * Rate limit: 4 requests per second
 */

class RateLimiter {
    constructor(requestsPerSecond) {
      this.requestsPerSecond = requestsPerSecond;
      this.intervalMs = 1000 / requestsPerSecond;
      this.lastRequestTime = 0;
    }
  
    async acquire() {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      if (timeSinceLastRequest < this.intervalMs) {
        const waitTime = this.intervalMs - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      this.lastRequestTime = Date.now();
    }
  }
  
  // Export rate limiter instance
  export const blooioRateLimiter = new RateLimiter(4); // 4 requests per second
  
  /**
   * Check single phone number with Blooio API
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {Promise<object>} - Blooio API result
   */
  export async function checkBlooioSingle(phoneNumber) {
    const apiKey = process.env.BLOOIO_API_KEY;
    
    if (!apiKey) {
      throw new Error('BLOOIO_API_KEY not configured');
    }
    
    try {
      const response = await fetch('https://api.bloo.io/v2/check-number', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          phone_number: phoneNumber
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Blooio API error for ${phoneNumber}:`, response.status, errorText);
        
        throw new Error(`Blooio API returned ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Transform Blooio response to our format
      return {
        phone_number: phoneNumber,
        is_ios: data.is_ios || false,
        supports_imessage: data.supports_imessage || false,
        supports_sms: data.supports_sms || false,
        contact_type: data.contact_type || null,
        contact_id: data.contact_id || null,
        error: null
      };
      
    } catch (error) {
      console.error(`Error checking ${phoneNumber} with Blooio:`, error);
      
      return {
        phone_number: phoneNumber,
        is_ios: false,
        supports_imessage: false,
        supports_sms: false,
        contact_type: null,
        contact_id: null,
        error: error.message
      };
    }
  }
  
  /**
   * Check multiple phone numbers (will respect rate limit internally)
   * @param {string[]} phoneNumbers - Array of phone numbers in E.164 format
   * @returns {Promise<object[]>} - Array of results
   */
  export async function checkBlooioBatch(phoneNumbers) {
    const results = [];
    
    for (const phone of phoneNumbers) {
      await blooioRateLimiter.acquire();
      const result = await checkBlooioSingle(phone);
      results.push(result);
    }
    
    return results;
  }