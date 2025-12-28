import { getConnection } from './db.js';

// In-memory cache using Map
const inMemoryCache = new Map();

// Cache stats
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Get phone numbers from cache (memory + database)
 */
export async function getFromAppCache(phoneNumbers) {
  if (!phoneNumbers || phoneNumbers.length === 0) {
    return {};
  }
  
  const results = {};
  
  try {
    // Check in-memory cache first
    for (const phone of phoneNumbers) {
      const cached = inMemoryCache.get(phone);
      if (cached) {
        results[phone] = cached;
        cacheHits++;
      }
    }
    
    // Get uncached from database
    const uncached = phoneNumbers.filter(p => !results[p]);
    
    if (uncached.length > 0) {
      const connection = await getConnection();
      
      const placeholders = uncached.map(() => '?').join(',');
      
      const [rows] = await connection.execute(
        `SELECT 
          e164,
          is_ios,
          supports_imessage,
          supports_sms,
          contact_type,
          contact_id,
          error
         FROM blooio_cache
         WHERE e164 IN (${placeholders})
         AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
        uncached
      );
      
      rows.forEach(row => {
        const cacheData = {
          is_ios: Boolean(row.is_ios),
          supports_imessage: Boolean(row.supports_imessage),
          supports_sms: Boolean(row.supports_sms),
          contact_type: row.contact_type,
          contact_id: row.contact_id,
          error: row.error
        };
        
        results[row.e164] = cacheData;
        inMemoryCache.set(row.e164, cacheData);
        cacheHits++;
      });
      
      cacheMisses += (uncached.length - rows.length);
    }
    
    return results;
    
  } catch (error) {
    console.error('Cache lookup error:', error);
    return {};
  }
}

/**
 * Save phone number result to cache (memory + database)
 */
export async function saveToAppCache(e164, data) {
  try {
    // Save to in-memory cache
    inMemoryCache.set(e164, data);
    
    // Save to database cache
    const connection = await getConnection();
    
    await connection.execute(
      `INSERT INTO blooio_cache 
       (e164, is_ios, supports_imessage, supports_sms, contact_type, contact_id, error, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         is_ios = VALUES(is_ios),
         supports_imessage = VALUES(supports_imessage),
         supports_sms = VALUES(supports_sms),
         contact_type = VALUES(contact_type),
         contact_id = VALUES(contact_id),
         error = VALUES(error),
         last_checked = NOW()`,
      [
        e164,
        data.is_ios ? 1 : 0,
        data.supports_imessage ? 1 : 0,
        data.supports_sms ? 1 : 0,
        data.contact_type,
        data.contact_id,
        data.error
      ]
    );
    
  } catch (error) {
    console.error('Cache save error:', error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    memorySize: inMemoryCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits > 0 ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(2) : 0
  };
}

/**
 * Clear in-memory cache
 */
export function clearMemoryCache() {
  inMemoryCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}