import { NextResponse } from 'next/server';
import { getCacheStats } from '../../../lib/appCache.js';  // ✅ Correct name

export const maxDuration = 10;

export async function GET() {
  try {
    const stats = getCacheStats();
    
    return NextResponse.json({
      success: true,
      stats: stats,
      message: `Memory cache: ${stats.memorySize} entries, ${stats.hitRate}% hit rate`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}