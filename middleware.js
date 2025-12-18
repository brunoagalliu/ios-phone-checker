import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // ✅ Allow Vercel Cron
  if (request.headers.get("x-vercel-cron") === "1") {
    return NextResponse.next();
  }

  // Public routes
  const publicRoutes = ['/login', '/api/auth/login'];
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    if (pathname.startsWith("/api")) {
      return new Response("Unauthorized", { status: 401 });
    }

    return NextResponse.redirect(
      new URL('/login', 'https://ios.smsapp.co')
    );
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api")) {
      return new Response("Unauthorized", { status: 401 });
    }

    return NextResponse.redirect(
      new URL('/login', 'https://ios.smsapp.co')
    );
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth/login|api/process-queue).*)',
  ],
};
