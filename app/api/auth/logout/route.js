import { NextResponse } from 'next/server';

export const maxDuration = 10;

export async function POST(request) {
  const response = NextResponse.json({
    success: true,
    message: 'Logged out successfully'
  });
  
  // Clear the auth cookie
  response.cookies.delete('auth-token');
  
  return response;
}