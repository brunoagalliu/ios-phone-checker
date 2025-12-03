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
      queueLimit: 0
    });
  }
  return pool;
}

export async function initializeDatabase() {
  const connection = await getConnection();
  
  // Create table if it doesn't exist
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS phone_checks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone_number VARCHAR(20) NOT NULL,
      is_ios BOOLEAN,
      supports_imessage BOOLEAN,
      supports_sms BOOLEAN,
      contact_type VARCHAR(20),
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      batch_id VARCHAR(50),
      INDEX idx_phone (phone_number),
      INDEX idx_batch (batch_id),
      INDEX idx_checked_at (checked_at)
    )
  `);
  
  return connection;
}

export async function savePhoneCheck(data) {
  const connection = await getConnection();
  
  await connection.execute(
    `INSERT INTO phone_checks 
    (phone_number, is_ios, supports_imessage, supports_sms, contact_type, batch_id) 
    VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.phone_number,
      data.is_ios || false,
      data.supports_imessage || false,
      data.supports_sms || false,
      data.contact_type || null,
      data.batch_id || null
    ]
  );
}

export async function getBatchResults(batchId) {
  const connection = await getConnection();
  
  const [rows] = await connection.execute(
    `SELECT * FROM phone_checks WHERE batch_id = ? ORDER BY id ASC`,
    [batchId]
  );
  
  return rows;
}