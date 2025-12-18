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
    try {
      console.log(`Calling Blooio API for: ${phoneNumber}`);
      
      const response = await fetch(BLOOIO_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone: phoneNumber })
      });
      
      const data = await response.json();
      
      // ✅ LOG RAW RESPONSE
      console.log('RAW Blooio response:', JSON.stringify(data, null, 2));
      
      // Check for errors
      if (!response.ok) {
        console.error('Blooio API error:', response.status);
        return {
          is_ios: null,
          supports_imessage: null,
          supports_sms: null,
          error: `HTTP ${response.status}`
        };
      }
      
      if (data.error) {
        console.error('Blooio returned error:', data.error);
        return {
          is_ios: null,
          supports_imessage: null,
          supports_sms: null,
          error: data.error
        };
      }
      
      // Parse response
      const result = {
        is_ios: data.is_ios || false,
        supports_imessage: data.supports_imessage || false,
        supports_sms: data.supports_sms || false,
        contact_type: data.contact_type || null,
        contact_id: data.contact_id || null,
        error: null
      };
      
      console.log('Parsed result:', result);
      
      return result;
      
    } catch (error) {
      console.error('Blooio request failed:', error);
      return {
        is_ios: null,
        supports_imessage: null,
        supports_sms: null,
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