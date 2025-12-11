import { getConnection } from './db.js';

const CACHE_EXPIRY_MONTHS = 6;

/**
 * Check if phone has been checked with Blooio (within 6 months)
 */
export async function getBlooioCache(phoneNumber) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_cache 
     WHERE phone_number = ? 
     AND blooio_checked = TRUE
     AND blooio_checked_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
     LIMIT 1`,
    [phoneNumber, CACHE_EXPIRY_MONTHS]
  );
  
  if (rows.length > 0) {
    const result = rows[0];
    const cacheAgeDays = Math.floor(
      (Date.now() - new Date(result.blooio_checked_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    console.log(`Blooio cache HIT for ${phoneNumber} (${cacheAgeDays} days old)`);
    
    return {
      phone_number: phoneNumber,
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
    };
  }
  
  console.log(`Blooio cache MISS for ${phoneNumber}`);
  return null;
}

/**
 * Check if phone has been checked with SubscriberVerify (within 6 months)
 */
export async function getSubscriberVerifyCache(phoneNumber) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_cache 
     WHERE phone_number = ? 
     AND sv_checked = TRUE
     AND sv_checked_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
     LIMIT 1`,
    [phoneNumber, CACHE_EXPIRY_MONTHS]
  );
  
  if (rows.length > 0) {
    const result = rows[0];
    const cacheAgeDays = Math.floor(
      (Date.now() - new Date(result.sv_checked_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    console.log(`SubscriberVerify cache HIT for ${phoneNumber} (${cacheAgeDays} days old)`);
    
    return {
      phone_number: phoneNumber,
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
    };
  }
  
  console.log(`SubscriberVerify cache MISS for ${phoneNumber}`);
  return null;
}

/**
 * Save Blooio result to cache
 */
export async function saveBlooioCache(data) {
  const connection = await getConnection();
  
  try {
    await connection.execute(
      `INSERT INTO phone_cache 
      (phone_number, blooio_checked, blooio_is_ios, blooio_supports_imessage, 
       blooio_supports_sms, blooio_contact_type, blooio_contact_id, blooio_checked_at, check_count)
      VALUES (?, TRUE, ?, ?, ?, ?, ?, NOW(), 1)
      ON DUPLICATE KEY UPDATE
        blooio_checked = TRUE,
        blooio_is_ios = VALUES(blooio_is_ios),
        blooio_supports_imessage = VALUES(blooio_supports_imessage),
        blooio_supports_sms = VALUES(blooio_supports_sms),
        blooio_contact_type = VALUES(blooio_contact_type),
        blooio_contact_id = VALUES(blooio_contact_id),
        blooio_checked_at = NOW(),
        check_count = check_count + 1`,
      [
        data.phone_number,
        data.is_ios ?? null,
        data.supports_imessage ?? null,
        data.supports_sms ?? null,
        data.contact_type || null,
        data.contact_id || null
      ]
    );
    
    console.log(`Saved Blooio cache for ${data.phone_number}`);
  } catch (error) {
    console.error('Error saving Blooio cache:', error);
    throw error;
  }
}

/**
 * Save SubscriberVerify result to cache
 */
export async function saveSubscriberVerifyCache(data) {
  const connection = await getConnection();
  
  try {
    await connection.execute(
      `INSERT INTO phone_cache 
      (phone_number, sv_checked, sv_action, sv_reason, sv_deliverable, sv_carrier, 
       sv_carrier_type, sv_is_mobile, sv_litigator, sv_blacklisted, sv_clicker,
       sv_geo_state, sv_geo_city, sv_timezone, sv_checked_at, check_count)
      VALUES (?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)
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
      [
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
      ]
    );
    
    console.log(`Saved SubscriberVerify cache for ${data.phone_number}`);
  } catch (error) {
    console.error('Error saving SubscriberVerify cache:', error);
    throw error;
  }
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