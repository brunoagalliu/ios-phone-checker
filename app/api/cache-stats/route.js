import { NextResponse } from 'next/server';
import { getAppCacheStats } from '../../../lib/appCache.js';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET() {
  try {
    // App cache stats
    const appStats = getAppCacheStats();
    
    // Database stats
    const connection = await getConnection();
    const [dbStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_cached,
        COUNT(CASE WHEN last_checked >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 END) as last_24h,
        COUNT(CASE WHEN last_checked >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as last_week,
        COUNT(CASE WHEN last_checked >= DATE_SUB(NOW(), INTERVAL 1 MONTH) THEN 1 END) as last_month
      FROM phone_checks
    `);
    
    return NextResponse.json({
      success: true,
      appCache: {
        entries: appStats.size,
        capacity: appStats.maxSize,
        usagePercent: parseFloat(appStats.usagePercent),
        speed: '<1ms',
        persistence: 'Until function cold start'
      },
      database: {
        total: dbStats[0].total_cached,
        last24h: dbStats[0].last_24h,
        lastWeek: dbStats[0].last_week,
        lastMonth: dbStats[0].last_month,
        speed: '10-30ms',
        persistence: 'Permanent'
      },
      strategy: {
        tier1: 'App Memory (warm functions)',
        tier2: 'Database (all queries)',
        tier3: 'API (uncached only)'
      }
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    });
  }
}