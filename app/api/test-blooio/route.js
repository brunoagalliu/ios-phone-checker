import { NextResponse } from 'next/server';
import { checkBlooioSingle } from '../../../lib/blooioClient.js';

export const maxDuration = 10;

export async function POST(request) {
  try {
    const { phoneNumber } = await request.json();
    
    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
    }
    
    console.log(`\n=== TESTING BLOOIO API ===`);
    console.log(`Phone: ${phoneNumber}`);
    
    const result = await checkBlooioSingle(phoneNumber);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    return NextResponse.json({
      success: true,
      phoneNumber: phoneNumber,
      apiResponse: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}