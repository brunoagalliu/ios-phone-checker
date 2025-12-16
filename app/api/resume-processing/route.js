import { NextResponse } from 'next/server';
import { addToQueue } from '../../../lib/db.js';

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    // Add back to queue
    await addToQueue(fileId, 10); // Higher priority for resumed files
    
    // Trigger queue worker
    fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/process-queue`, {
      method: 'POST'
    }).catch(err => console.log('Queue trigger sent'));
    
    return NextResponse.json({
      success: true,
      message: 'Processing resumed'
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}