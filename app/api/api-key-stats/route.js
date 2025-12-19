import { NextResponse } from 'next/server';

export const maxDuration = 10;

export async function GET() {
  const hasApiKey = !!process.env.BLOOIO_API_KEY;
  
  return NextResponse.json({
    success: true,
    stats: {
      apiKeyConfigured: hasApiKey,
      processingMode: 'Parallel batches',
      batchSize: 4,
      rateLimit: '4 requests per second',
      parallelProcessing: true
    },
    message: hasApiKey 
      ? 'Single API key with parallel batch processing (4 simultaneous requests)' 
      : 'API key not configured'
  });
}