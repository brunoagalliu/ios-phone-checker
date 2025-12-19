import { NextResponse } from 'next/server';
import { blooioRateLimiter } from '../../../lib/blooioClient.js';

export const maxDuration = 30;

export async function GET() {
  const testCount = 20;
  const start = Date.now();
  
  console.log(`Testing rate limiter with ${testCount} calls...`);
  
  for (let i = 0; i < testCount; i++) {
    const callStart = Date.now();
    await blooioRateLimiter.acquire();
    const waitTime = Date.now() - callStart;
    
    if (i < 5) {
      console.log(`Call ${i + 1}: waited ${waitTime}ms`);
    }
  }
  
  const totalTime = Date.now() - start;
  const actualRate = (testCount / (totalTime / 1000)).toFixed(2);
  
  console.log(`\nCompleted ${testCount} calls in ${totalTime}ms`);
  console.log(`Actual rate: ${actualRate} req/sec`);
  
  return NextResponse.json({
    success: true,
    testCount: testCount,
    totalTimeMs: totalTime,
    actualRate: parseFloat(actualRate),
    expectedRate: 4,
    isCorrect: Math.abs(actualRate - 4) < 0.5
  });
}