import { NextResponse } from 'next/server';
import { executeWithRetry } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

// ✅ In-memory cache (30 seconds)
let statsCache = null;
let lastUpdate = 0;
const CACHE_TTL = 30000;

export async function GET() {
  const now = Date.now();
  const cacheAge = now - lastUpdate;
  
  // Return cached if fresh
  if (statsCache && cacheAge < CACHE_TTL) {
    return NextResponse.json({
      ...statsCache,
      cached: true,
      cacheAge: Math.floor(cacheAge / 1000)
    });
  }
  
  try {
    // ✅ All queries in parallel with single connection
    const [
      [activeFiles],
      [completedFiles],
      [cacheStats]
    ] = await Promise.all([
      // Active files
      executeWithRetry(`
        SELECT 
          id,
          file_name,
          processing_status,
          processing_offset,
          processing_total,
          processing_progress,
          upload_date,
          service
        FROM uploaded_files
        WHERE processing_status IN ('processing', 'initialized')
        ORDER BY upload_date DESC
        LIMIT 20
      `),
      
      // Completed files
      executeWithRetry(`
        SELECT 
          id,
          file_name,
          processing_status,
          processing_total,
          processing_offset,
          processing_progress,
          upload_date,
          results_file_url,
          service
        FROM uploaded_files
        WHERE processing_status = 'completed'
        ORDER BY upload_date DESC
        LIMIT 20
      `),
      
      // Cache stats
      executeWithRetry(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as iphones,
          SUM(CASE WHEN supports_imessage = 0 THEN 1 ELSE 0 END) as androids
        FROM blooio_cache
      `)
    ]);
    
    // Build response
    statsCache = {
      activeFiles,
      completedFiles,
      cacheStats: {
        memorySize: cacheStats[0]?.total || 0,
        hits: cacheStats[0]?.iphones || 0,
        misses: cacheStats[0]?.androids || 0,
        hitRate: cacheStats[0]?.total > 0 
          ? Math.round((cacheStats[0].iphones / cacheStats[0].total) * 100) 
          : 0,
        total: cacheStats[0]?.total || 0,
        iphones: cacheStats[0]?.iphones || 0,
        androids: cacheStats[0]?.androids || 0
      },
      timestamp: new Date().toISOString()
    };
    
    lastUpdate = now;
    
    return NextResponse.json({
      ...statsCache,
      success: true,
      cached: false,
      cacheAge: 0
    });
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    
    // Return stale cache on error
    if (statsCache) {
      return NextResponse.json({
        ...statsCache,
        success: true,
        cached: true,
        cacheAge: Math.floor((now - lastUpdate) / 1000),
        error: 'Using cached data'
      });
    }
    
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}