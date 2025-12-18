// Global cache (persists during warm function instances)
const phoneCache = new Map();
const CACHE_MAX_SIZE = 50000;     // Store up to 50k phones
const CACHE_TTL = 1800000;        // 30 minutes in ms

/**
 * Get from app cache (ultra-fast, <1ms)
 */
export function getFromAppCache(phoneNumber) {
  const cached = phoneCache.get(phoneNumber);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return {
      ...cached.data,
      from_cache: true,
      cache_source: 'app-memory',
      cache_age_ms: Date.now() - cached.timestamp
    };
  }
  
  // Expired, remove it
  if (cached) {
    phoneCache.delete(phoneNumber);
  }
  
  return null;
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