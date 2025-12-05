import { NextResponse } from 'next/server';
import { getUploadedFiles, getBatchResults } from '../../../lib/db.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    
    if (batchId) {
      // Get specific batch results
      const results = await getBatchResults(batchId);
      return NextResponse.json({
        success: true,
        batch_id: batchId,
        count: results.length,
        results: results
      });
    } else {
      // Get all uploaded files
      const files = await getUploadedFiles(100);
      return NextResponse.json({
        success: true,
        count: files.length,
        files: files
      });
    }
    
  } catch (error) {
    console.error('Get files error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}