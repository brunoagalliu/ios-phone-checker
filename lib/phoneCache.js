import { getConnection } from './db.js';

const CACHE_EXPIRY_MONTHS = 6;

/**
 * Batch check if phones have been checked with Blooio (within 6 months)
 */
export async function getBlooioCacheBatch(phoneNumbers) {
  if (phoneNumbers.length === 0) return [];
  
  const connection = await getConnection();
  
  const placeholders = phoneNumbers.map(() => '?').join(',');
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_cache 
     WHERE phone_number IN (${placeholders})
     AND blooio_checked = TRUE
     AND blooio_checked_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)`,
    [...phoneNumbers, CACHE_EXPIRY_MONTHS]
  );
  
  console.log(`Blooio batch cache: ${rows.length} hits out of ${phoneNumbers.length} queries`);
  
  // Convert to map for easy lookup
  const cacheMap = new Map();
  
  rows.forEach(result => {
    const cacheAgeDays = Math.floor(
      (Date.now() - new Date(result.blooio_checked_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    cacheMap.set(result.phone_number, {
      phone_number: result.phone_number,
      is_ios: result.blooio_is_ios,
      supports_imessage: result.blooio_supports_imessage,
      supports_sms: result.blooio_supports_sms,
      contact_type: result.blooio_contact_type,
      contact_id: result.blooio_contact_id,
      from_cache: true,
      cache_age_days: cacheAgeDays,
      cache_type: 'blooio',
      last_checked: result.blooio_checked_at,
      check_count: result.check_count
    });
  });
  
  return cacheMap;
}

/**
 * Batch check if phones have been checked with SubscriberVerify (within 6 months)
 */
export async function getSubscriberVerifyCacheBatch(phoneNumbers) {
  if (phoneNumbers.length === 0) return new Map();
  
  const connection = await getConnection();
  
  const placeholders = phoneNumbers.map(() => '?').join(',');
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_cache 
     WHERE phone_number IN (${placeholders})
     AND sv_checked = TRUE
     AND sv_checked_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)`,
    [...phoneNumbers, CACHE_EXPIRY_MONTHS]
  );
  
  console.log(`SubscriberVerify batch cache: ${rows.length} hits out of ${phoneNumbers.length} queries`);
  
  // Convert to map for easy lookup
  const cacheMap = new Map();
  
  rows.forEach(result => {
    const cacheAgeDays = Math.floor(
      (Date.now() - new Date(result.sv_checked_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    cacheMap.set(result.phone_number, {
      phone_number: result.phone_number,
      action: result.sv_action,
      reason: result.sv_reason,
      deliverable: result.sv_deliverable,
      carrier: result.sv_carrier,
      carrier_type: result.sv_carrier_type,
      is_mobile: result.sv_is_mobile,
      litigator: result.sv_litigator,
      blacklisted: result.sv_blacklisted,
      clicker: result.sv_clicker,
      geo_state: result.sv_geo_state,
      geo_city: result.sv_geo_city,
      timezone: result.sv_timezone,
      from_cache: true,
      cache_age_days: cacheAgeDays,
      cache_type: 'subscriberverify',
      last_checked: result.sv_checked_at,
      check_count: result.check_count
    });
  });
  
  return cacheMap;
}

/**
 * Batch save Blooio results to cache
 */
export async function saveBlooioCacheBatch(dataArray) {
  if (dataArray.length === 0) return;
  
  const connection = await getConnection();
  
  const values = dataArray.map(data => [
    data.phone_number,
    data.is_ios ?? null,
    data.supports_imessage ?? null,
    data.supports_sms ?? null,
    data.contact_type || null,
    data.contact_id || null
  ]);
  
  const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
  const flatValues = values.flat();
  
  try {
    await connection.execute(
      `INSERT INTO phone_cache 
      (phone_number, blooio_checked, blooio_is_ios, blooio_supports_imessage, 
       blooio_supports_sms, blooio_contact_type, blooio_contact_id, blooio_checked_at, check_count)
      VALUES ${placeholders.replace(/\(([^)]+)\)/g, '($1, TRUE, NOW(), 1)')}
      ON DUPLICATE KEY UPDATE
        blooio_checked = TRUE,
        blooio_is_ios = VALUES(blooio_is_ios),
        blooio_supports_imessage = VALUES(blooio_supports_imessage),
        blooio_supports_sms = VALUES(blooio_supports_sms),
        blooio_contact_type = VALUES(blooio_contact_type),
        blooio_contact_id = VALUES(blooio_contact_id),
        blooio_checked_at = NOW(),
        check_count = check_count + 1`,
      flatValues
    );
    
    console.log(`Batch saved ${dataArray.length} Blooio results to cache`);
  } catch (error) {
    console.error('Error batch saving Blooio cache:', error);
    throw error;
  }
}

/**
 * Batch save SubscriberVerify results to cache
 */
export async function saveSubscriberVerifyCacheBatch(dataArray) {
  if (dataArray.length === 0) return;
  
  const connection = await getConnection();
  
  // Build VALUES clause with all data
  const valueStrings = [];
  const flatValues = [];
  
  dataArray.forEach(data => {
    valueStrings.push('(?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)');
    flatValues.push(
      data.phone_number,
      data.action || null,
      data.reason || null,
      data.deliverable ?? null,
      data.carrier || null,
      data.carrier_type || null,
      data.is_mobile ?? null,
      data.litigator ?? null,
      data.blacklisted ?? null,
      data.clicker ?? null,
      data.geo_state || null,
      data.geo_city || null,
      data.timezone || null
    );
  });
  
  try {
    await connection.execute(
      `INSERT INTO phone_cache 
      (phone_number, sv_checked, sv_action, sv_reason, sv_deliverable, sv_carrier, 
       sv_carrier_type, sv_is_mobile, sv_litigator, sv_blacklisted, sv_clicker,
       sv_geo_state, sv_geo_city, sv_timezone, sv_checked_at, check_count)
      VALUES ${valueStrings.join(',')}
      ON DUPLICATE KEY UPDATE
        sv_checked = TRUE,
        sv_action = VALUES(sv_action),
        sv_reason = VALUES(sv_reason),
        sv_deliverable = VALUES(sv_deliverable),
        sv_carrier = VALUES(sv_carrier),
        sv_carrier_type = VALUES(sv_carrier_type),
        sv_is_mobile = VALUES(sv_is_mobile),
        sv_litigator = VALUES(sv_litigator),
        sv_blacklisted = VALUES(sv_blacklisted),
        sv_clicker = VALUES(sv_clicker),
        sv_geo_state = VALUES(sv_geo_state),
        sv_geo_city = VALUES(sv_geo_city),
        sv_timezone = VALUES(sv_timezone),
        sv_checked_at = NOW(),
        check_count = check_count + 1`,
      flatValues
    );
    
    console.log(`Batch saved ${dataArray.length} SubscriberVerify results to cache`);
  } catch (error) {
    console.error('Error batch saving SubscriberVerify cache:', error);
    throw error;
  }
}

/**
 * Single check functions (keep for backwards compatibility)
 */
export async function getBlooioCache(phoneNumber) {
  const cacheMap = await getBlooioCacheBatch([phoneNumber]);
  return cacheMap.get(phoneNumber) || null;
}

export async function getSubscriberVerifyCache(phoneNumber) {
  const cacheMap = await getSubscriberVerifyCacheBatch([phoneNumber]);
  return cacheMap.get(phoneNumber) || null;
}

export async function saveBlooioCache(data) {
  return saveBlooioCacheBatch([data]);
}

export async function saveSubscriberVerifyCache(data) {
  return saveSubscriberVerifyCacheBatch([data]);
}

/**
 * Get cache statistics
 */
export async function getCacheStats() {
  const connection = await getConnection();
  
  const [stats] = await connection.execute(`
    SELECT 
      COUNT(*) as total_cached,
      SUM(blooio_checked) as blooio_count,
      SUM(sv_checked) as sv_count,
      SUM(CASE WHEN blooio_checked AND sv_checked THEN 1 ELSE 0 END) as both_services,
      AVG(check_count) as avg_check_count,
      SUM(check_count) as total_api_calls_saved
    FROM phone_cache
  `);
  
  return stats[0];
}