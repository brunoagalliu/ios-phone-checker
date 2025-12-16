import mysql from 'mysql2/promise';

let pool;

/**
 * Get database connection pool
 */
export async function getConnection() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DATABASE_HOST,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      port: process.env.DATABASE_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

/**
 * Save phone check result with file association
 */
export async function savePhoneCheckWithFile(result, fileId) {
  const connection = await getConnection();
  
  await connection.execute(
    `INSERT INTO phone_checks 
    (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, 
     error, batch_id, file_id, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      is_ios = VALUES(is_ios),
      supports_imessage = VALUES(supports_imessage),
      supports_sms = VALUES(supports_sms),
      contact_type = VALUES(contact_type),
      contact_id = VALUES(contact_id),
      error = VALUES(error),
      last_checked_at = NOW()`,
    [
      result.phone_number,
      result.is_ios || false,
      result.supports_imessage || false,
      result.supports_sms || false,
      result.contact_type || null,
      result.contact_id || null,
      result.error || null,
      result.batch_id || null,
      fileId
    ]
  );
}

/**
 * Save phone check result (basic version without file association)
 */
export async function savePhoneCheck(result) {
  const connection = await getConnection();
  
  await connection.execute(
    `INSERT INTO phone_checks 
    (phone_number, is_ios, supports_imessage, supports_sms, contact_type, contact_id, 
     error, batch_id, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      is_ios = VALUES(is_ios),
      supports_imessage = VALUES(supports_imessage),
      supports_sms = VALUES(supports_sms),
      contact_type = VALUES(contact_type),
      contact_id = VALUES(contact_id),
      error = VALUES(error),
      last_checked_at = NOW()`,
    [
      result.phone_number,
      result.is_ios || false,
      result.supports_imessage || false,
      result.supports_sms || false,
      result.contact_type || null,
      result.contact_id || null,
      result.error || null,
      result.batch_id || null
    ]
  );
}

/**
 * Save uploaded file metadata with blob URLs
 */
export async function saveUploadedFile(fileData) {
  const connection = await getConnection();
  
  console.log('=== SAVING FILE TO DB ===');
  console.log('File name:', fileData.file_name);
  console.log('Processing status:', fileData.processing_status);
  console.log('Has processing_state:', !!fileData.processing_state);
  console.log('State length:', fileData.processing_state?.length || 0);
  console.log('Can resume:', fileData.can_resume);
  
  // Check if processing_state column exists
  try {
    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM uploaded_files LIKE 'processing_state'"
    );
    console.log('processing_state column exists:', columns.length > 0);
    if (columns.length > 0) {
      console.log('Column type:', columns[0].Type);
    } else {
      console.error('❌ processing_state column does NOT exist!');
    }
  } catch (checkError) {
    console.error('Column check error:', checkError);
  }
  
  try {
    const [result] = await connection.execute(
      `INSERT INTO uploaded_files 
      (file_name, original_name, file_size, total_numbers, valid_numbers, invalid_numbers, 
       duplicate_numbers, batch_id, processing_status, storage_path, original_file_url, 
       original_file_size, processing_offset, processing_total, processing_progress, 
       processing_state, can_resume) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        fileData.can_resume ? 1 : 0
      ]
    );
    
    console.log('✓ INSERT successful, ID:', result.insertId);
    console.log('Rows affected:', result.affectedRows);
    
    // Verify what was actually saved
    const [verify] = await connection.execute(
      'SELECT id, processing_status, LENGTH(processing_state) as state_size, can_resume FROM uploaded_files WHERE id = ?',
      [result.insertId]
    );
    
    console.log('Verification after insert:', verify[0]);
    
    if (verify[0].state_size === 0 || verify[0].state_size === null) {
      console.error('❌ WARNING: processing_state is NULL or 0 bytes!');
      console.error('Original state length:', fileData.processing_state?.length || 0);
    } else {
      console.log('✓ processing_state saved successfully:', verify[0].state_size, 'bytes');
    }
    
    return result.insertId;
  } catch (error) {
    console.error('=== SAVE ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('SQL State:', error.sqlState);
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
  
  console.log(`Updating file ${fileId} with results URL: ${safeResultsUrl}, size: ${safeResultsSize}`);
  
  try {
    await connection.execute(
      `UPDATE uploaded_files 
       SET results_file_url = ?, results_file_size = ? 
       WHERE id = ?`,
      [safeResultsUrl, safeResultsSize, fileId]
    );
    
    console.log(`Successfully updated file ${fileId} with results URL`);
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
    
    console.log(`Updated file ${fileId} status to: ${status}`);
  } catch (error) {
    console.error('updateFileStatus error:', error);
    throw error;
  }
}

/**
 * Get file by batch ID
 */
export async function getFileByBatchId(batchId) {
  const connection = await getConnection();
  
  const [files] = await connection.execute(
    'SELECT * FROM uploaded_files WHERE batch_id = ? LIMIT 1',
    [batchId]
  );
  
  return files[0] || null;
}

/**
 * Get statistics (alias for getDatabaseStats)
 */
export async function getStatistics() {
  return getDatabaseStats();
}
/**
 * Get phone checks by batch ID
 */
export async function getPhoneChecksByBatchId(batchId) {
  const connection = await getConnection();
  
  const [results] = await connection.execute(
    `SELECT phone_number, is_ios, supports_imessage, supports_sms, 
            contact_type, contact_id, error, last_checked_at
     FROM phone_checks 
     WHERE batch_id = ?
     ORDER BY id`,
    [batchId]
  );
  
  return results;
}

/**
 * Get batch results by batch ID (alias for getPhoneChecksByBatchId)
 */
export async function getBatchResults(batchId) {
  return getPhoneChecksByBatchId(batchId);
}

/**
 * Get all uploaded files with metadata
 */
export async function getAllUploadedFiles() {
  const connection = await getConnection();
  
  const [files] = await connection.execute(
    `SELECT id, file_name, original_name, batch_id, total_numbers, 
            valid_numbers, invalid_numbers, duplicate_numbers, 
            processing_status, upload_date, results_file_url, 
            results_file_size, original_file_url, original_file_size,
            processing_offset, processing_total, processing_progress,
            can_resume
     FROM uploaded_files 
     ORDER BY upload_date DESC`
  );
  
  return files;
}

/**
 * Get uploaded files (alias for getAllUploadedFiles)
 */
export async function getUploadedFiles() {
  return getAllUploadedFiles();
}

/**
 * Get file by ID
 */
export async function getFileById(fileId) {
  const connection = await getConnection();
  
  const [files] = await connection.execute(
    'SELECT * FROM uploaded_files WHERE id = ?',
    [fileId]
  );
  
  return files[0] || null;
}

/**
 * Delete old phone check records
 */
export async function cleanOldPhoneChecks(daysOld = 30) {
  const connection = await getConnection();
  
  const [result] = await connection.execute(
    'DELETE FROM phone_checks WHERE last_checked_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [daysOld]
  );
  
  return result.affectedRows;
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  const connection = await getConnection();
  
  const [fileStats] = await connection.execute(
    `SELECT 
      COUNT(*) as total_files,
      SUM(total_numbers) as total_numbers_processed,
      SUM(valid_numbers) as total_valid_numbers,
      AVG(valid_numbers) as avg_numbers_per_file
     FROM uploaded_files`
  );
  
  const [checkStats] = await connection.execute(
    `SELECT 
      COUNT(*) as total_checks,
      SUM(CASE WHEN is_ios = 1 THEN 1 ELSE 0 END) as ios_count,
      SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as imessage_count
     FROM phone_checks`
  );
  
  return {
    files: fileStats[0],
    checks: checkStats[0]
  };
}