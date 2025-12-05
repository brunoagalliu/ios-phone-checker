import mysql from 'mysql2/promise';

let pool;

export async function getConnection() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }
  return pool;
}

export async function initializeDatabase() {
  const connection = await getConnection();
  
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS phone_checks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone_number VARCHAR(20) NOT NULL,
      is_ios BOOLEAN DEFAULT NULL,
      supports_imessage BOOLEAN DEFAULT NULL,
      supports_sms BOOLEAN DEFAULT NULL,
      contact_type VARCHAR(20),
      contact_id VARCHAR(100),
      error TEXT,
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      check_count INT DEFAULT 1,
      batch_id VARCHAR(50),
      source VARCHAR(20) DEFAULT 'api',
      
      INDEX idx_phone (phone_number),
      INDEX idx_checked_at (checked_at),
      INDEX idx_last_checked (last_checked),
      INDEX idx_batch (batch_id),
      UNIQUE KEY unique_phone (phone_number)
    )
  `);
  
  return connection;
}

/**
 * Check if phone number was checked within last 6 months
 * @param {string} phoneNumber - Phone number in E.164 format
 * @returns {object|null} - Cached result or null if not found/expired
 */
export async function getCachedPhoneCheck(phoneNumber) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_checks 
     WHERE phone_number = ? 
     AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
     LIMIT 1`,
    [phoneNumber]
  );
  
  if (rows.length > 0) {
    console.log(`Cache HIT for ${phoneNumber} - checked ${rows[0].last_checked}`);
    return {
      ...rows[0],
      from_cache: true,
      cache_age_days: Math.floor((Date.now() - new Date(rows[0].last_checked).getTime()) / (1000 * 60 * 60 * 24))
    };
  }
  
  console.log(`Cache MISS for ${phoneNumber} - will check via API`);
  return null;
}

/**
 * Save or update phone check result
 * @param {object} data - Phone check data
 */
export async function savePhoneCheck(data) {
  const connection = await getConnection();
  
  try {
    // Check if phone number already exists
    const [existing] = await connection.execute(
      'SELECT id, check_count FROM phone_checks WHERE phone_number = ?',
      [data.phone_number]
    );
    
    if (existing.length > 0) {
      // Update existing record
      await connection.execute(
        `UPDATE phone_checks SET 
          is_ios = ?,
          supports_imessage = ?,
          supports_sms = ?,
          contact_type = ?,
          contact_id = ?,
          error = ?,
          last_checked = NOW(),
          check_count = check_count + 1,
          batch_id = ?,
          source = ?
        WHERE phone_number = ?`,
        [
          data.is_ios ?? null,
          data.supports_imessage ?? null,
          data.supports_sms ?? null,
          data.contact_type || null,
          data.contact_id || null,
          data.error || null,
          data.batch_id || null,
          data.source || 'api',
          data.phone_number
        ]
      );
      
      console.log(`Updated existing record for ${data.phone_number}`);
    } else {
      // Insert new record
      await connection.execute(
        `INSERT INTO phone_checks 
        (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, error, batch_id, source, check_count) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          data.phone_number,
          data.is_ios ?? null,
          data.supports_imessage ?? null,
          data.supports_sms ?? null,
          data.contact_type || null,
          data.contact_id || null,
          data.error || null,
          data.batch_id || null,
          data.source || 'api'
        ]
      );
      
      console.log(`Inserted new record for ${data.phone_number}`);
    }
  } catch (error) {
    console.error('Error saving phone check:', error);
    throw error;
  }
}

/**
 * Get batch results
 */
export async function getBatchResults(batchId) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_checks WHERE batch_id = ? ORDER BY id ASC`,
    [batchId]
  );
  
  return rows;
}

/**
 * Get statistics
 */
export async function getStatistics() {
  const connection = await getConnection();
  
  const [stats] = await connection.execute(`
    SELECT 
      COUNT(*) as total_checks,
      SUM(is_ios = 1) as total_ios,
      SUM(is_ios = 0) as total_non_ios,
      SUM(error IS NOT NULL) as total_errors,
      COUNT(DISTINCT phone_number) as unique_numbers,
      COUNT(CASE WHEN last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH) THEN 1 END) as recent_checks,
      SUM(check_count) as total_api_calls_saved
    FROM phone_checks
  `);
  
  return stats[0];
}

/**
 * Clean old records (optional - run periodically)
 */
export async function cleanOldRecords(monthsToKeep = 12) {
  const connection = await getConnection();
  
  const [result] = await connection.execute(
    `DELETE FROM phone_checks 
     WHERE last_checked < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
    [monthsToKeep]
  );
  
  console.log(`Cleaned ${result.affectedRows} old records`);
  return result.affectedRows;
}

/**
 * Save uploaded file metadata with blob URLs
 */
export async function saveUploadedFile(fileData) {
  const connection = await getConnection();
  
  const [result] = await connection.execute(
    `INSERT INTO uploaded_files 
    (file_name, original_name, file_size, total_numbers, valid_numbers, invalid_numbers, 
     duplicate_numbers, batch_id, processing_status, storage_path, original_file_url, 
     original_file_size) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileData.file_name,
      fileData.original_name,
      fileData.file_size || 0,
      fileData.total_numbers || 0,
      fileData.valid_numbers || 0,
      fileData.invalid_numbers || 0,
      fileData.duplicate_numbers || 0,
      fileData.batch_id,
      fileData.processing_status || 'uploaded',
      fileData.storage_path || null,
      fileData.original_file_url || null,
      fileData.original_file_size || 0
    ]
  );
  
  return result.insertId;
}

/**
 * Update file with results blob URL
 */
export async function updateFileResultsURL(fileId, resultsUrl, resultsSize) {
  const connection = await getConnection();
  
  await connection.execute(
    `UPDATE uploaded_files 
     SET results_file_url = ?, results_file_size = ? 
     WHERE id = ?`,
    [resultsUrl, resultsSize, fileId]
  );
}

/**
 * Update file processing status
 */
export async function updateFileStatus(fileId, status, additionalData = {}) {
  const connection = await getConnection();
  
  const updates = ['processing_status = ?'];
  const values = [status];
  
  if (additionalData.valid_numbers !== undefined) {
    updates.push('valid_numbers = ?');
    values.push(additionalData.valid_numbers);
  }
  
  if (additionalData.invalid_numbers !== undefined) {
    updates.push('invalid_numbers = ?');
    values.push(additionalData.invalid_numbers);
  }
  
  if (additionalData.duplicate_numbers !== undefined) {
    updates.push('duplicate_numbers = ?');
    values.push(additionalData.duplicate_numbers);
  }
  
  values.push(fileId);
  
  await connection.execute(
    `UPDATE uploaded_files SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

/**
 * Get all uploaded files
 */
export async function getUploadedFiles(limit = 50) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM uploaded_files 
     ORDER BY upload_date DESC 
     LIMIT ?`,
    [limit]
  );
  
  return rows;
}

/**
 * Get file by batch ID
 */
export async function getFileByBatchId(batchId) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM uploaded_files WHERE batch_id = ? LIMIT 1`,
    [batchId]
  );
  
  return rows[0] || null;
}

/**
 * Save phone check with file reference
 */
export async function savePhoneCheckWithFile(data, fileId) {
  const connection = await getConnection();
  
  try {
    const [existing] = await connection.execute(
      'SELECT id, check_count FROM phone_checks WHERE phone_number = ?',
      [data.phone_number]
    );
    
    if (existing.length > 0) {
      await connection.execute(
        `UPDATE phone_checks SET 
          is_ios = ?,
          supports_imessage = ?,
          supports_sms = ?,
          contact_type = ?,
          contact_id = ?,
          error = ?,
          last_checked = NOW(),
          check_count = check_count + 1,
          batch_id = ?,
          source = ?,
          file_id = ?
        WHERE phone_number = ?`,
        [
          data.is_ios ?? null,
          data.supports_imessage ?? null,
          data.supports_sms ?? null,
          data.contact_type || null,
          data.contact_id || null,
          data.error || null,
          data.batch_id || null,
          data.source || 'api',
          fileId,
          data.phone_number
        ]
      );
    } else {
      await connection.execute(
        `INSERT INTO phone_checks 
        (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, 
         error, batch_id, source, check_count, file_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          data.phone_number,
          data.is_ios ?? null,
          data.supports_imessage ?? null,
          data.supports_sms ?? null,
          data.contact_type || null,
          data.contact_id || null,
          data.error || null,
          data.batch_id || null,
          data.source || 'api',
          fileId
        ]
      );
    }
  } catch (error) {
    console.error('Error saving phone check:', error);
    throw error;
  }
}