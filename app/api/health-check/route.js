import { NextResponse } from 'next/server';

export async function GET() {
  const issues = [];
  
  // Check Blooio config
  if (!process.env.BLOOIO_API_URL) {
    issues.push('BLOOIO_API_URL not configured');
  }
  if (!process.env.BLOOIO_API_KEY) {
    issues.push('BLOOIO_API_KEY not configured');
  }
  
  // Check database config
  if (!process.env.DB_HOST) {
    issues.push('DB_HOST not configured');
  }
  
  if (issues.length > 0) {
    return NextResponse.json({
      healthy: false,
      issues: issues
    }, { status: 500 });
  }
  
  return NextResponse.json({
    healthy: true,
    message: 'All environment variables configured'
  });
}