import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      );
    }

    const connection = await getConnection();

    // Get file details
    const [files] = await connection.execute(
      `SELECT 
        id,
        file_name,
        original_name,
        batch_id,
        processing_status,
        processing_offset,
        processing_total,
        processing_progress,
        can_resume,
        valid_numbers,
        invalid_numbers,
        duplicate_numbers,
        results_file_url,
        results_file_size,
        upload_date,
        processing_state
      FROM uploaded_files 
      WHERE id = ?`,
      [fileId]
    );

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    const file = files[0];

    // Determine service from processing_state
    let service = 'unknown';
    if (file.processing_state) {
      try {
        const state = JSON.parse(file.processing_state);
        service = state.service || 'unknown';
      } catch (e) {
        console.error('Failed to parse processing_state:', e);
      }
    }

    // Get chunk count if processing
    let chunksProcessed = 0;
    if (file.processing_status === 'processing' || file.processing_status === 'completed') {
      const [chunks] = await connection.execute(
        'SELECT COUNT(*) as count FROM processing_chunks WHERE file_id = ?',
        [fileId]
      );
      chunksProcessed = chunks[0].count;
    }

    return NextResponse.json({
      id: file.id,
      file_name: file.file_name,
      original_name: file.original_name,
      batch_id: file.batch_id,
      processing_status: file.processing_status,
      processing_offset: file.processing_offset || 0,
      processing_total: file.processing_total || file.valid_numbers,
      processing_progress: parseFloat(file.processing_progress || 0),
      can_resume: file.can_resume === 1,
      valid_numbers: file.valid_numbers,
      invalid_numbers: file.invalid_numbers,
      duplicate_numbers: file.duplicate_numbers,
      results_file_url: file.results_file_url,
      results_file_size: file.results_file_size,
      upload_date: file.upload_date,
      service: service,
      chunks_processed: chunksProcessed,
      estimated_remaining: calculateEstimatedTime(
        file.processing_total - file.processing_offset,
        service
      )
    });

  } catch (error) {
    console.error('File progress error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

function calculateEstimatedTime(remainingRecords, service) {
  if (remainingRecords <= 0) return '0 minutes';

  if (service === 'blooio') {
    const chunksRemaining = Math.ceil(remainingRecords / 200);
    const minutesRemaining = Math.ceil(chunksRemaining * 1);
    return `${minutesRemaining} minutes`;
  } else {
    const chunksRemaining = Math.ceil(remainingRecords / 5000);
    const minutesRemaining = Math.ceil(chunksRemaining * 0.25);
    return `${minutesRemaining} minutes`;
  }
}