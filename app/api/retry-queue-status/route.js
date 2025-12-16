import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    
    const connection = await getConnection();
    
    const query = fileId
      ? `SELECT 
           status,
           COUNT(*) as count,
           AVG(retry_count) as avg_retries
         FROM retry_queue
         WHERE file_id = ?
         GROUP BY status`
      : `SELECT 
           status,
           COUNT(*) as count,
           AVG(retry_count) as avg_retries
         FROM retry_queue
         GROUP BY status`;
    
    const params = fileId ? [fileId] : [];
    const [stats] = await connection.execute(query, params);
    
    return NextResponse.json({
      success: true,
      stats: stats
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}