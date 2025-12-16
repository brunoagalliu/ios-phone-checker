import { NextResponse } from 'next/server';
import { getActiveFiles } from '../../../lib/db.js';

export async function GET() {
  try {
    const files = await getActiveFiles();
    
    return NextResponse.json({
      success: true,
      files: files
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}