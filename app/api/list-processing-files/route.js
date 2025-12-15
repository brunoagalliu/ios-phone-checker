import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export async function GET(request) {
  try {
    const connection = await getConnection();

    const [files] = await connection.execute(
      `SELECT 
        id,
        file_name,
        processing_status,
        processing_offset,
        processing_total,
        processing_progress,
        upload_date
      FROM uploaded_files 
      WHERE processing_status IN ('initialized', 'processing', 'finalizing')
      ORDER BY upload_date DESC
      LIMIT 20`
    );

    return NextResponse.json({
      success: true,
      files: files
    });

  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}