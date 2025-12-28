// Global cache (persists during warm function instances)
const phoneCache = new Map();
const CACHE_MAX_SIZE = 50000;     // Store up to 50k phones
const CACHE_TTL = 1800000;        // 30 minutes in ms

/**
 * Get from app cache (ultra-fast, <1ms)
 */
export async function getFromAppCache(phoneNumbers) {
    // Return empty object if no phones
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
        });
      }
      
      console.log(`Cache: ${Object.keys(results).length}/${phoneNumbers.length} hits`);
      
      return results;
      
    } catch (error) {
      console.error('Cache lookup error:', error);
      return {}; // Return empty object on error, not null
    }
  }

/**
 * Get batch from app cache
 */
export function getBatchFromAppCache(phoneNumbers) {
  const start = Date.now();
  const cached = {};
  let hitCount = 0;
  
  phoneNumbers.forEach(phone => {
    const data = getFromAppCache(phone);
    if (data) {
      cached[phone] = data;
      hitCount++;
    }
  });
  
  const duration = Date.now() - start;
  console.log(`✓ App cache: ${hitCount}/${phoneNumbers.length} hits in ${duration}ms`);
  
  return cached;
}

/**
 * Save to app cache
 */
export function saveToAppCache(phoneNumber, data) {
  // Prevent cache from growing too large
  if (phoneCache.size >= CACHE_MAX_SIZE) {
    // Remove oldest 10% of entries
    const entriesToRemove = Math.floor(CACHE_MAX_SIZE * 0.1);
    let removed = 0;
    
    for (const [key] of phoneCache) {
      phoneCache.delete(key);
      removed++;
      if (removed >= entriesToRemove) break;
    }
    
    console.log(`🧹 Cleaned up ${removed} old cache entries`);
  }
  
  phoneCache.set(phoneNumber, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Save batch to app cache
 */
export function saveBatchToAppCache(phoneData) {
  phoneData.forEach(data => {
    const phone = data.phone_number || data.e164;
    saveToAppCache(phone, data);
  });
}

/**
 * Get cache stats
 */
export function getAppCacheStats() {
  return {
    size: phoneCache.size,
    maxSize: CACHE_MAX_SIZE,
    usagePercent: (phoneCache.size / CACHE_MAX_SIZE * 100).toFixed(1)
  };
}

/**
 * Clear app cache
 */
export function clearAppCache() {
  const size = phoneCache.size;
  phoneCache.clear();
  console.log(`🗑️ Cleared ${size} entries from app cache`);
  return size;
}