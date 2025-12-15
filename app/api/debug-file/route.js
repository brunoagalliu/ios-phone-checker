import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    const connection = await getConnection();

    // Get file details
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const file = files[0];

    // Try to parse processing_state
    let processingState = null;
    let stateError = null;
    
    if (file.processing_state) {
      try {
        processingState = JSON.parse(file.processing_state);
      } catch (e) {
        stateError = e.message;
      }
    }

    // Get chunks
    const [chunks] = await connection.execute(
      'SELECT chunk_offset, LENGTH(chunk_data) as size, created_at FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset',
      [fileId]
    );

    return NextResponse.json({
      file: {
        id: file.id,
        file_name: file.file_name,
        processing_status: file.processing_status,
        processing_offset: file.processing_offset,
        processing_total: file.processing_total,
        processing_progress: file.processing_progress,
        can_resume: file.can_resume,
        valid_numbers: file.valid_numbers,
        has_processing_state: !!file.processing_state,
        processing_state_length: file.processing_state?.length || 0,
        upload_date: file.upload_date
      },
      processing_state: processingState,
      state_error: stateError,
      chunks: chunks,
      chunks_count: chunks.length,
      database_columns: Object.keys(file)
    });

  } catch (error) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}