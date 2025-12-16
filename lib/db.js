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
      keepAliveInitialDelay: 0,
      charset: 'utf8mb4'
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
      file_id INT,
      
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
 */
export async function savePhoneCheck(data) {
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
 * Clean old records
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
 * Save uploaded file metadata with blob URLs and chunked processing support
 */
export async function saveUploadedFile(fileData) {
  const connection = await getConnection();
  
  console.log('=== SAVING FILE TO DB ===');
  console.log('File name:', fileData.file_name);
  console.log('Has processing_state:', !!fileData.processing_state);
  console.log('State length:', fileData.processing_state?.length || 0);
  
  const safeData = {
    file_name: fileData.file_name || null,
    original_name: fileData.original_name || null,
    file_size: fileData.file_size || 0,
    total_numbers: fileData.total_numbers || 0,
    valid_numbers: fileData.valid_numbers || 0,
    invalid_numbers: fileData.invalid_numbers || 0,
    duplicate_numbers: fileData.duplicate_numbers || 0,
    batch_id: fileData.batch_id || null,
    processing_status: fileData.processing_status || 'uploaded',
    storage_path: fileData.storage_path || null,
    original_file_url: fileData.original_file_url || null,
    original_file_size: fileData.original_file_size || 0,
    processing_offset: fileData.processing_offset || 0,
    processing_total: fileData.processing_total || 0,
    processing_progress: fileData.processing_progress || 0,
    processing_state: fileData.processing_state || null,
    can_resume: fileData.can_resume ? 1 : 0
  };
  
  try {
    const [result] = await connection.execute(
      `INSERT INTO uploaded_files 
      (file_name, original_name, file_size, total_numbers, valid_numbers, invalid_numbers, 
       duplicate_numbers, batch_id, processing_status, storage_path, original_file_url, 
       original_file_size, processing_offset, processing_total, processing_progress, 
       processing_state, can_resume) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeData.file_name,
        safeData.original_name,
        safeData.file_size,
        safeData.total_numbers,
        safeData.valid_numbers,
        safeData.invalid_numbers,
        safeData.duplicate_numbers,
        safeData.batch_id,
        safeData.processing_status,
        safeData.storage_path,
        safeData.original_file_url,
        safeData.original_file_size,
        safeData.processing_offset,
        safeData.processing_total,
        safeData.processing_progress,
        safeData.processing_state,
        safeData.can_resume
      ]
    );
    
    console.log(`✓ File inserted with ID: ${result.insertId}`);
    
    // Verify processing_state was saved
    if (fileData.processing_state) {
      const [verify] = await connection.execute(
        'SELECT LENGTH(processing_state) as state_size FROM uploaded_files WHERE id = ?',
        [result.insertId]
      );
      console.log('State verification:', verify[0]);
    }
    
    return result.insertId;
  } catch (error) {
    console.error('saveUploadedFile SQL error:', error);
    throw error;
  }
}

/**
 * Update file with results blob URL
 */
export async function updateFileResultsURL(fileId, resultsUrl, resultsSize) {
  const connection = await getConnection();
  
  const safeResultsUrl = resultsUrl || null;
  const safeResultsSize = resultsSize || 0;
  
  console.log(`Updating file ${fileId} with results URL`);
  
  try {
    await connection.execute(
      `UPDATE uploaded_files 
       SET results_file_url = ?, results_file_size = ? 
       WHERE id = ?`,
      [safeResultsUrl, safeResultsSize, fileId]
    );
    
    console.log(`✓ Updated file ${fileId} with results URL`);
  } catch (error) {
    console.error('updateFileResultsURL error:', error);
    throw error;
  }
}

/**
 * Update file status and stats
 */
export async function updateFileStatus(fileId, status, additionalData = {}) {
  const connection = await getConnection();
  
  const updates = ['processing_status = ?'];
  const values = [status];
  
  const fieldMap = {
    valid_numbers: 'valid_numbers',
    invalid_numbers: 'invalid_numbers',
    duplicate_numbers: 'duplicate_numbers',
    sv_send_count: 'sv_send_count',
    sv_unsubscribe_count: 'sv_unsubscribe_count',
    sv_blacklist_count: 'sv_blacklist_count',
    processing_offset: 'processing_offset',
    processing_total: 'processing_total',
    processing_progress: 'processing_progress'
  };
  
  Object.keys(fieldMap).forEach(key => {
    if (additionalData[key] !== undefined) {
      updates.push(`${fieldMap[key]} = ?`);
      values.push(additionalData[key] === null ? null : additionalData[key]);
    }
  });
  
  values.push(fileId);
  
  try {
    await connection.execute(
      `UPDATE uploaded_files SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    console.log(`✓ Updated file ${fileId} status to: ${status}`);
  } catch (error) {
    console.error('updateFileStatus error:', error);
    throw error;
  }
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
 * Get file by ID
 */
export async function getFileById(fileId) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM uploaded_files WHERE id = ?`,
    [fileId]
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
          fileId || null,
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
          data.phone_number || null,
          data.is_ios ?? null,
          data.supports_imessage ?? null,
          data.supports_sms ?? null,
          data.contact_type || null,
          data.contact_id || null,
          data.error || null,
          data.batch_id || null,
          data.source || 'api',
          fileId || null
        ]
      );
    }
  } catch (error) {
    console.error('Error saving phone check:', error);
    throw error;
  }
}

/**
 * Get phone checks by batch ID
 */
export async function getPhoneChecksByBatchId(batchId) {
  const connection = await getConnection();
  
  const [results] = await connection.execute(
    `SELECT phone_number, is_ios, supports_imessage, supports_sms, 
            contact_type, contact_id, error, last_checked
     FROM phone_checks 
     WHERE batch_id = ?
     ORDER BY id`,
    [batchId]
  );
  
  return results;
}

/**
 * Get all uploaded files (alias)
 */
export async function getAllUploadedFiles() {
  return getUploadedFiles();
}

/**
 * Get database statistics (alias)
 */
export async function getDatabaseStats() {
  return getStatistics();
}

/**
 * Delete old phone check records
 */
export async function cleanOldPhoneChecks(daysOld = 30) {
  const connection = await getConnection();
  
  const [result] = await connection.execute(
    'DELETE FROM phone_checks WHERE last_checked < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [daysOld]
  );
  
  return result.affectedRows;
}
/**
 * Add file to processing queue
 */
export async function addToQueue(fileId, priority = 0) {
  const connection = await getConnection();
  
  try {
    await connection.execute(
      `INSERT INTO processing_queue (file_id, status, priority)
       VALUES (?, 'queued', ?)`,
      [fileId, priority]
    );
    
    console.log(`✓ Added file ${fileId} to processing queue`);
    return true;
  } catch (error) {
    console.error('Failed to add to queue:', error);
    throw error;
  }
}

/**
 * Get all files in queue or processing
 */
export async function getQueuedFiles() {
  const connection = await getConnection();
  
  const [files] = await connection.execute(
    `SELECT 
      f.*,
      q.status as queue_status,
      q.started_at as queue_started_at,
      q.priority
     FROM uploaded_files f
     JOIN processing_queue q ON f.id = q.file_id
     WHERE q.status IN ('queued', 'processing')
     ORDER BY q.priority DESC, q.created_at ASC`
  );
  
  return files;
}

/**
 * Get files that are actively processing or resumable
 */
export async function getActiveFiles() {
  const connection = await getConnection();
  
  const [files] = await connection.execute(
    `SELECT * FROM uploaded_files
     WHERE (processing_status IN ('processing', 'initialized') 
            OR (can_resume = 1 AND processing_progress < 100))
       AND processing_state IS NOT NULL
     ORDER BY upload_date DESC`
  );
  
  return files;
}