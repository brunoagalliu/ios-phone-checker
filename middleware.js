import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  
  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/api/auth/login'];
  
  // Check if current path is public
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }
  
  // Get auth token from cookies
  const token = request.cookies.get('auth-token')?.value;
  
  // If no token, redirect to login
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
  
  // Verify token
  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
    );
    
    await jwtVerify(token, secret);
    
    // Token is valid, allow request
    return NextResponse.next();
    
  } catch (error) {
    console.error('Token verification failed:', error);
    
    // Invalid token, redirect to login
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth/login).*)',
  ],
};