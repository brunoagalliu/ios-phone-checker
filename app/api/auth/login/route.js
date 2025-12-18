import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';

export const maxDuration = 10;

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    
    // Get credentials from environment variables
    const validUsername = process.env.ADMIN_USERNAME || 'admin';
    const validPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    
    // Validate credentials
    if (username === validUsername && password === validPassword) {
      // Create JWT token
      const secret = new TextEncoder().encode(
        process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
      );
      
      const token = await new SignJWT({ username })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);
      
      // Create response with cookie
      const response = NextResponse.json({
        success: true,
        message: 'Login successful'
      });
      
      // Set HTTP-only cookie
      response.cookies.set('auth-token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 86400, // 24 hours
        path: '/'
      });
      
      return response;
    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid username or password'
      }, { status: 401 });
    }
    
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({
      success: false,
      error: 'Login failed'
    }, { status: 500 });
  }
}