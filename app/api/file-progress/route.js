import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    
    if (!fileId) {
      return NextResponse.json({ 
        success: false,
        error: 'File ID required' 
      }, { status: 400 });
    }
    
    const connection = await getConnection();
    
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ 
        success: false,
        error: 'File not found' 
      }, { status: 404 });
    }
    
    const file = files[0];
    
    return NextResponse.json({
      success: true,
      file: {
        id: file.id,
        file_name: file.file_name,
        processing_status: file.processing_status,
        processing_offset: file.processing_offset,
        processing_total: file.processing_total,
        processing_progress: parseFloat(file.processing_progress) || 0,
        can_resume: file.can_resume === 1,
        processing_state: file.processing_state ? true : false, // Don't return full state (too large)
        last_error: file.last_error,
        upload_date: file.upload_date
      }
    });
    
  } catch (error) {
    console.error('File progress error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}