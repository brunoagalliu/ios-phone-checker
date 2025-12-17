import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;

export async function GET() {
  try {
    console.log('Warming up database connection...');
    
    const connection = await getConnection();
    
    // Simple query to warm up connection
    await connection.execute('SELECT 1 as warmup');
    
    console.log('✓ Database warmed up');
    
    return NextResponse.json({
      success: true,
      message: 'Database connection warmed up'
    });
    
  } catch (error) {
    console.error('Warmup failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}