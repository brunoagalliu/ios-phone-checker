import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const connection = await getConnection();
    
    const [files] = await connection.execute(
      `SELECT 
        id,
        file_name,
        processing_status,
        processing_total,
        upload_date,
        service
       FROM uploaded_files
       WHERE processing_status = 'completed'
       ORDER BY upload_date DESC
       LIMIT 50`
    );
    
    return NextResponse.json({
      success: true,
      files: files,
      count: files.length
    });
    
  } catch (error) {
    console.error('Completed files error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}