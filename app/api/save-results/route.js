import { NextResponse } from 'next/server';
import { getBatchResults } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    
    if (!batchId) {
      return NextResponse.json(
        { error: 'Batch ID is required' },
        { status: 400 }
      );
    }
    
    const results = await getBatchResults(batchId);
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      count: results.length,
      results: results
    });
    
  } catch (error) {
    console.error('Get results error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}