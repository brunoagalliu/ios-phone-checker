import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET() {
  let connection;
  
  try {
    console.log('Fetching active files...');
    
    // Get connection with timeout
    connection = await Promise.race([
      getConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout')), 5000)
      )
    ]);
    
    console.log('Database connected, querying active files...');
    
    // Query with timeout
    const [files] = await Promise.race([
      connection.execute(
        `SELECT 
          id,
          file_name,
          original_name,
          processing_status,
          processing_offset,
          processing_total,
          processing_progress,
          can_resume,
          upload_date
         FROM uploaded_files
         WHERE processing_status IN ('initialized', 'processing')
           AND processing_state IS NOT NULL
         ORDER BY upload_date DESC
         LIMIT 10`
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 5000)
      )
    ]);
    
    console.log(`Found ${files.length} active files`);
    
    return NextResponse.json({
      success: true,
      files: files || []
    });
    
  } catch (error) {
    console.error('Active files error:', error);
    console.error('Error stack:', error.stack);
    
    // Return empty array on error so UI doesn't break
    return NextResponse.json({
      success: true, // Still return success to prevent UI errors
      files: [],
      warning: error.message
    }, { status: 200 }); // Return 200 instead of 500
    
  }
}