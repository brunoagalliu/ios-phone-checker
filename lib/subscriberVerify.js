/**
 * SubscriberVerify API Integration
 * Bulk phone validation before iOS detection
 */

const SUBSCRIBER_VERIFY_API = 'https://api.subscriberverify.com/api';
const SUBSCRIBER_VERIFY_BULK_API = 'https://api.subscriberverify.com/api-bulk';

/**
 * Check single phone number
 */
export async function checkSingleNumber(phone, ip = null, list = 'default') {
  const apiKey = process.env.SUBSCRIBER_VERIFY_API_KEY;
  
  if (!apiKey) {
    throw new Error('SubscriberVerify API key not configured');
  }
  
  try {
    const params = new URLSearchParams({
      key: apiKey,
      phone: phone,
      list: list,
    });
    
    if (ip) {
      params.append('ip', ip);
    }
    
    const response = await fetch(`${SUBSCRIBER_VERIFY_API}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`SubscriberVerify API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error('SubscriberVerify error:', error);
    throw error;
  }
}

/**
 * Bulk check phone numbers (up to 1000 at once)
 */
export async function checkBulkNumbers(phones, ips = null) {
  const apiKey = process.env.SUBSCRIBER_VERIFY_API_KEY;
  
  if (!apiKey) {
    throw new Error('SubscriberVerify API key not configured');
  }
  
  if (phones.length > 1000) {
    throw new Error('Maximum 1000 records per bulk request');
  }
  
  try {
    // Build records array
    const records = phones.map((phone, index) => {
      const record = { phone: phone };
      if (ips && ips[index]) {
        record.ip = ips[index];
      }
      return record;
    });
    
    const requestBody = {
      key: apiKey,
      records: records
    };
    
    console.log(`SubscriberVerify bulk check: ${phones.length} numbers`);
    
    const response = await fetch(SUBSCRIBER_VERIFY_BULK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SubscriberVerify bulk API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error('SubscriberVerify returned error response');
    }
    
    console.log(`SubscriberVerify bulk complete: ${data.lookups} lookups`);
    
    return data.results;
    
  } catch (error) {
    console.error('SubscriberVerify bulk error:', error);
    throw error;
  }
}

/**
 * Check available credits
 */
export async function checkCredits() {
  const apiKey = process.env.SUBSCRIBER_VERIFY_API_KEY;
  
  if (!apiKey) {
    throw new Error('SubscriberVerify API key not configured');
  }
  
  try {
    const response = await fetch(`${SUBSCRIBER_VERIFY_API}?key=${apiKey}&credits=1`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Credits check failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.availableCredits;
    
  } catch (error) {
    console.error('Credits check error:', error);
    throw error;
  }
}

export function categorizeBulkResults(results) {
    const categorized = {
      send: [],
      unsubscribe: [],
      blacklist: [],
      error: []
    };
    
    results.forEach((result, index) => {
      const category = {
        index: index,
        phone: result.subscriber,
        action: result.action,
        reason: result.reason,
        nanpType: result.nanpType,
        carrier: result.dipCarrier || result.nanpCarrier,
        carrierType: result.dipCarrierType,
        litigator: result.litigator,
        blackList: result.blackList,
        clicker: result.clicker,  // ADD THIS
        geoState: result.geoState,
        geoCity: result.geoCity,
        timezone: result.timezone,
      };
      
      switch (result.action) {
        case 'send':
          if (result.nanpType === 'mobile' || result.dipCarrierType === 'mobile') {
            categorized.send.push(category);
          } else {
            category.reason = 'Not a mobile number';
            categorized.unsubscribe.push(category);
          }
          break;
        case 'unsubscribe':
          categorized.unsubscribe.push(category);
          break;
        case 'blacklist':
          categorized.blacklist.push(category);
          break;
        case 'error':
          categorized.error.push(category);
          break;
        default:
          categorized.error.push(category);
      }
    });
    
    return categorized;
  }

/**
 * Process phones in batches of 1000
 */
export async function checkBulkInBatches(phones, batchSize = 1000) {
  const allResults = [];
  
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} numbers`);
    
    const results = await checkBulkNumbers(batch);
    allResults.push(...results);
    
    // Small delay between batches to be respectful
    if (i + batchSize < phones.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return allResults;
}