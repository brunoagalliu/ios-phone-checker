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
    console.log('🔌 Creating database connection pool (3 connections)...');
    
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      
      // ✅ MINIMAL connection pool for VPS
      connectionLimit: 3,           // Only 3 connections
      waitForConnections: true,
      queueLimit: 0,                // Unlimited queue
      
      // ✅ Keep connections alive
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,  // 10s keepalive
      
      // ✅ Timeouts
      connectTimeout: 10000,         // 10s to establish connection
      
      // ✅ Other settings
      charset: 'utf8mb4',
      multipleStatements: false,
    });
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('❌ Pool error:', err.code);
      // Don't auto-recreate - let retry logic handle it
    });
    
    // Test connection
    console.log('Testing connection...');
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    
    console.log('✅ Connection pool ready (3 connections)');
    
    return pool;
    
  } catch (error) {
    console.error('❌ Failed to create pool:', error.code, error.message);
    pool = null;
    throw error;
  } finally {
    poolInitializing = false;
  }
}

// ✅ Execute with retry (handles ECONNRESET)
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
        error.code === 'ENOTFOUND' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ECONNREFUSED' ||
        error.message?.includes('Pool is closed') ||
        error.errno === -104;
      
      if (isRetriable && attempt < maxRetries - 1) {
        console.warn(`⚠️ DB error (attempt ${attempt + 1}/${maxRetries}):`, error.code);
        
        // Force pool recreation on connection errors
        if (pool) {
          try {
            await pool.end();
          } catch (e) {
            // Ignore close errors
          }
          pool = null;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const waitMs = 1000 * Math.pow(2, attempt);
        console.log(`   Waiting ${waitMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        
        continue;
      }
      
      // Not retriable or out of retries
      console.error('❌ DB query failed:', error.message);
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
    return { healthy: true, message: 'Database OK' };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

// ✅ Graceful shutdown
export async function closePool() {
  if (pool) {
    console.log('Closing database pool...');
    try {
      await pool.end();
      console.log('✅ Pool closed');
    } catch (e) {
      console.error('Error closing pool:', e.message);
    }
    pool = null;
  }
}

// ==========================================
// Helper functions (using executeWithRetry)
// ==========================================

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
    'SELECT id FROM phone_checks WHERE phone_number = ?',
    [data.phone_number]
  );
  
  if (existing.length > 0) {
    await executeWithRetry(
      `UPDATE phone_checks SET 
        is_ios = ?, supports_imessage = ?, supports_sms = ?,
        contact_type = ?, contact_id = ?, error = ?,
        last_checked = NOW(), check_count = check_count + 1,
        batch_id = ?, source = ?
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
      (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, error, batch_id, source) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      COUNT(DISTINCT phone_number) as unique_numbers
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
  const [result] = await executeWithRetry(
    `INSERT INTO uploaded_files 
    (file_name, original_name, file_size, total_numbers, valid_numbers, invalid_numbers, 
     duplicate_numbers, batch_id, processing_status, storage_path, original_file_url, 
     original_file_size, processing_offset, processing_total, processing_progress, 
     processing_state, can_resume, service) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileData.file_name || null,
      fileData.original_name || null,
      fileData.file_size || 0,
      fileData.total_numbers || 0,
      fileData.valid_numbers || 0,
      fileData.invalid_numbers || 0,
      fileData.duplicate_numbers || 0,
      fileData.batch_id || null,
      fileData.processing_status || 'uploaded',
      fileData.storage_path || null,
      fileData.original_file_url || null,
      fileData.original_file_size || 0,
      fileData.processing_offset || 0,
      fileData.processing_total || 0,
      fileData.processing_progress || 0,
      fileData.processing_state || null,
      fileData.can_resume ? 1 : 0,
      fileData.service || 'blooio'
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
  
  const fields = {
    valid_numbers: 'valid_numbers',
    invalid_numbers: 'invalid_numbers',
    processing_offset: 'processing_offset',
    processing_total: 'processing_total',
    processing_progress: 'processing_progress',
    last_error: 'last_error'
  };
  
  Object.keys(fields).forEach(key => {
    if (additionalData[key] !== undefined) {
      updates.push(`${fields[key]} = ?`);
      values.push(additionalData[key]);
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
    'SELECT id FROM phone_checks WHERE phone_number = ?',
    [data.phone_number]
  );
  
  if (existing.length > 0) {
    await executeWithRetry(
      `UPDATE phone_checks SET 
        is_ios = ?, supports_imessage = ?, supports_sms = ?,
        contact_type = ?, error = ?,
        last_checked = NOW(), check_count = check_count + 1,
        file_id = ?
      WHERE phone_number = ?`,
      [
        data.is_ios ?? null,
        data.supports_imessage ?? null,
        data.supports_sms ?? null,
        data.contact_type || null,
        data.error || null,
        fileId || null,
        data.phone_number
      ]
    );
  } else {
    await executeWithRetry(
      `INSERT INTO phone_checks 
      (phone_number, is_ios, supports_imessage, supports_sms, contact_type, error, file_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.phone_number,
        data.is_ios ?? null,
        data.supports_imessage ?? null,
        data.supports_sms ?? null,
        data.contact_type || null,
        data.error || null,
        fileId || null
      ]
    );
  }
}

export async function getPhoneChecksByBatchId(batchId) {
  const [results] = await executeWithRetry(
    `SELECT phone_number, is_ios, supports_imessage, supports_sms, 
            contact_type, error, last_checked
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
    `SELECT f.*, q.status as queue_status
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
     WHERE processing_status IN ('processing', 'initialized')
     ORDER BY upload_date DESC`
  );
  return files;
}