import { NextResponse } from 'next/server';
import { getApiKeyStats } from '../../../lib/blooioClient.js';

export const maxDuration = 10;

export async function GET() {
  try {
    const stats = getApiKeyStats();
    
    return NextResponse.json({
      success: true,
      stats: stats,
      message: `Using ${stats.totalKeys} API key(s) for ${stats.effectiveRate} req/sec`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    });
  }
}