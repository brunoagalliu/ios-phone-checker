import { NextResponse } from 'next/server';
import { executeMultiple } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

let statsCache = null;
let lastUpdate = 0;
const CACHE_TTL = 30000;

export async function GET() {
  const now = Date.now();
  
  if (statsCache && (now - lastUpdate) < CACHE_TTL) {
    return NextResponse.json({
      ...statsCache,
      cached: true,
      cacheAge: Math.floor((now - lastUpdate) / 1000)
    });
  }
  
  try {
    // ✅ Execute all queries with single connection
    const [
      [activeFiles],
      [completedFiles],
      [cacheStats],
      [fileStats]
    ] = await executeMultiple([
      {
        query: `SELECT id, file_name, processing_status, processing_offset, 
                processing_total, processing_progress, upload_date, service
                FROM uploaded_files
                WHERE processing_status IN ('processing', 'initialized')
                ORDER BY upload_date DESC LIMIT 10`,
        params: []
      },
      {
        query: `SELECT id, file_name, processing_status, processing_total, 
                processing_progress, upload_date, results_file_url, service
                FROM uploaded_files
                WHERE processing_status = 'completed'
                ORDER BY upload_date DESC LIMIT 10`,
        params: []
      },
      {
        query: `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as iphones,
                SUM(CASE WHEN supports_imessage = 0 THEN 1 ELSE 0 END) as androids
                FROM blooio_cache`,
        params: []
      },
      {
        query: `SELECT processing_status, COUNT(*) as count
                FROM uploaded_files
                GROUP BY processing_status`,
        params: []
      }
    ]);
    
    statsCache = {
      activeFiles,
      completedFiles,
      cacheStats: {
        total: cacheStats[0]?.total || 0,
        iphones: cacheStats[0]?.iphones || 0,
        androids: cacheStats[0]?.androids || 0,
        hitRate: cacheStats[0]?.total > 0 
          ? Math.round((cacheStats[0].iphones / cacheStats[0].total) * 100) 
          : 0
      },
      fileStats,
      timestamp: new Date().toISOString()
    };
    
    lastUpdate = now;
    
    return NextResponse.json({
      ...statsCache,
      success: true,
      cached: false
    });
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    
    if (statsCache) {
      return NextResponse.json({
        ...statsCache,
        success: true,
        cached: true,
        error: 'Using stale cache'
      });
    }
    
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}