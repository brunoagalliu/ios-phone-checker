import mysql from 'mysql2/promise';

let pool = null;
let poolInitializing = false;

export async function getConnection() {
  // Return existing pool
  if (pool) {
    return pool;
  }
  
  // Wait if pool is being initialized
  if (poolInitializing) {
    while (poolInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return pool;
  }
  
  // Initialize new pool
  poolInitializing = true;
  
  try {
    console.log('🔌 Creating database connection pool...');
    
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      
      // Simple, stable config
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0,
      
      // Keep connections alive
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      
      // Timeouts
      connectTimeout: 10000,
      // ❌ REMOVED: acquireTimeout (not valid for pools)
      
      // Other settings
      charset: 'utf8mb4',
      multipleStatements: false,
    });
    
    // Handle errors
    pool.on('error', (err) => {
      console.error('Pool error:', err.code);
    });
    
    // Test connection
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    
    console.log('✅ Connection pool ready');
    
    return pool;
    
  } catch (error) {
    console.error('❌ Failed to create pool:', error.code);
    pool = null;
    throw error;
  } finally {
    poolInitializing = false;
  }
}

// ✅ Execute with retry
export async function executeWithRetry(query, params = [], maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const connection = await getConnection();
      const [rows] = await connection.execute(query, params);
      return [rows];
      
    } catch (error) {
      lastError = error;
      
      const isRetriable = 
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.message?.includes('Pool is closed');
      
      if (isRetriable && attempt < maxRetries - 1) {
        console.warn(`DB error (attempt ${attempt + 1}/${maxRetries}):`, error.code || error.message);
        
        // Force pool recreation
        if (pool) {
          try {
            await pool.end();
          } catch (e) {
            // Ignore
          }
          pool = null;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

// ✅ Health check
export async function checkHealth() {
  try {
    const connection = await getConnection();
    const conn = await connection.getConnection();
    await conn.ping();
    conn.release();
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

// ✅ Graceful shutdown
export async function closePool() {
  if (pool) {
    console.log('Closing pool...');
    try {
      await pool.end();
    } catch (e) {
      console.error('Error closing pool:', e.message);
    }
    pool = null;
  }
}

// Keep all your existing helper functions below, just replace pool.execute with executeWithRetry

export async function initializeDatabase() {
  await executeWithRetry(`
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
}

export async function getCachedPhoneCheck(phoneNumber) {
  const [rows] = await executeWithRetry(
    `SELECT * FROM phone_checks 
     WHERE phone_number = ? 
     AND last_checked >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
     LIMIT 1`,
    [phoneNumber]
  );
  
  if (rows.length > 0) {
    return {
      ...rows[0],
      from_cache: true,
      cache_age_days: Math.floor((Date.now() - new Date(rows[0].last_checked).getTime()) / (1000 * 60 * 60 * 24))
    };
  }
  
  return null;
}

export async function savePhoneCheck(data) {
  const [existing] = await executeWithRetry(
    'SELECT id, check_count FROM phone_checks WHERE phone_number = ?',
    [data.phone_number]
  );
  
  if (existing.length > 0) {
    await executeWithRetry(
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
  } else {
    await executeWithRetry(
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
  }
}

export async function getBatchResults(batchId) {
  const [rows] = await executeWithRetry(
    `SELECT * FROM phone_checks WHERE batch_id = ? ORDER BY id ASC`,
    [batchId]
  );
  return rows;
}

export async function getStatistics() {
  const [stats] = await executeWithRetry(`
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

export async function cleanOldRecords(monthsToKeep = 12) {
  const [result] = await executeWithRetry(
    `DELETE FROM phone_checks WHERE last_checked < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
    [monthsToKeep]
  );
  return result.affectedRows;
}

export async function saveUploadedFile(fileData) {
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
    can_resume: fileData.can_resume ? 1 : 0,
    service: fileData.service || 'blooio'
  };
  
  const [result] = await executeWithRetry(
    `INSERT INTO uploaded_files 
    (file_name, original_name, file_size, total_numbers, valid_numbers, invalid_numbers, 
     duplicate_numbers, batch_id, processing_status, storage_path, original_file_url, 
     original_file_size, processing_offset, processing_total, processing_progress, 
     processing_state, can_resume, service) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      safeData.can_resume,
      safeData.service
    ]
  );
  
  return result.insertId;
}

export async function updateFileResultsURL(fileId, resultsUrl, resultsSize) {
  await executeWithRetry(
    `UPDATE uploaded_files SET results_file_url = ?, results_file_size = ? WHERE id = ?`,
    [resultsUrl || null, resultsSize || 0, fileId]
  );
}

export async function updateFileStatus(fileId, status, additionalData = {}) {
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
    processing_progress: 'processing_progress',
    last_error: 'last_error'
  };
  
  Object.keys(fieldMap).forEach(key => {
    if (additionalData[key] !== undefined) {
      updates.push(`${fieldMap[key]} = ?`);
      values.push(additionalData[key] === null ? null : additionalData[key]);
    }
  });
  
  values.push(fileId);
  
  await executeWithRetry(
    `UPDATE uploaded_files SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

export async function getUploadedFiles(limit = 50) {
  const [rows] = await executeWithRetry(
    `SELECT * FROM uploaded_files ORDER BY upload_date DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

export async function getFileByBatchId(batchId) {
  const [rows] = await executeWithRetry(
    `SELECT * FROM uploaded_files WHERE batch_id = ? LIMIT 1`,
    [batchId]
  );
  return rows[0] || null;
}

export async function getFileById(fileId) {
  const [rows] = await executeWithRetry(
    `SELECT * FROM uploaded_files WHERE id = ?`,
    [fileId]
  );
  return rows[0] || null;
}

export async function savePhoneCheckWithFile(data, fileId) {
  const [existing] = await executeWithRetry(
    'SELECT id, check_count FROM phone_checks WHERE phone_number = ?',
    [data.phone_number]
  );
  
  if (existing.length > 0) {
    await executeWithRetry(
      `UPDATE phone_checks SET 
        is_ios = ?, supports_imessage = ?, supports_sms = ?,
        contact_type = ?, contact_id = ?, error = ?,
        last_checked = NOW(), check_count = check_count + 1,
        batch_id = ?, source = ?, file_id = ?
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
    await executeWithRetry(
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
}

export async function getPhoneChecksByBatchId(batchId) {
  const [results] = await executeWithRetry(
    `SELECT phone_number, is_ios, supports_imessage, supports_sms, 
            contact_type, contact_id, error, last_checked
     FROM phone_checks WHERE batch_id = ? ORDER BY id`,
    [batchId]
  );
  return results;
}

export async function getAllUploadedFiles() {
  return getUploadedFiles();
}

export async function getDatabaseStats() {
  return getStatistics();
}

export async function cleanOldPhoneChecks(daysOld = 30) {
  const [result] = await executeWithRetry(
    'DELETE FROM phone_checks WHERE last_checked < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [daysOld]
  );
  return result.affectedRows;
}

export async function addToQueue(fileId, priority = 0) {
  await executeWithRetry(
    `INSERT INTO processing_queue (file_id, status, priority) VALUES (?, 'queued', ?)`,
    [fileId, priority]
  );
  return true;
}

export async function getQueuedFiles() {
  const [files] = await executeWithRetry(
    `SELECT f.*, q.status as queue_status, q.started_at as queue_started_at, q.priority
     FROM uploaded_files f
     JOIN processing_queue q ON f.id = q.file_id
     WHERE q.status IN ('queued', 'processing')
     ORDER BY q.priority DESC, q.created_at ASC`
  );
  return files;
}

export async function getActiveFiles() {
  const [files] = await executeWithRetry(
    `SELECT * FROM uploaded_files
     WHERE (processing_status IN ('processing', 'initialized') 
            OR (can_resume = 1 AND processing_progress < 100))
       AND processing_state IS NOT NULL
     ORDER BY upload_date DESC`
  );
  return files;
}