import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET() {
  let connection;
  
  try {
    console.log('Fetching file history...');
    
    // Get connection with timeout
    connection = await Promise.race([
      getConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout')), 5000)
      )
    ]);
    
    console.log('Database connected, querying files...');
    
    // Query with timeout
    const [files] = await Promise.race([
      connection.execute(
        `SELECT 
          id,
          file_name,
          original_name,
          batch_id,
          total_numbers,
          valid_numbers,
          invalid_numbers,
          duplicate_numbers,
          processing_status,
          processing_progress,
          upload_date,
          results_file_url,
          results_file_size,
          original_file_url
         FROM uploaded_files
         ORDER BY upload_date DESC
         LIMIT 50`
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 5000)
      )
    ]);
    
    console.log(`Found ${files.length} files in history`);
    
    return NextResponse.json({
      success: true,
      files: files || []
    });
    
  } catch (error) {
    console.error('File history error:', error);
    console.error('Error stack:', error.stack);
    
    // Return empty array on error
    return NextResponse.json({
      success: true,
      files: [],
      warning: error.message
    }, { status: 200 });
    
  }
}