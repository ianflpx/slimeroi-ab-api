import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

interface DomainConfig {
  urlA: string;
  urlB: string;
  split: number;
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const domain = host.split(':')[0]; // Get domain without port
  
  // Try to fetch configuration for this domain from Edge Config
  const domainConfig = await get<DomainConfig>(domain);

  if (!domainConfig || !domainConfig.urlA || !domainConfig.urlB) {
    return NextResponse.next();
  }

  const cookieName = `sr_variant_${domain.replace(/\./g, '_')}`;
  let variant = request.cookies.get(cookieName)?.value;

  if (!variant) {
    // If no variant cookie, perform A/B split
    const random = Math.random();
    variant = random < (domainConfig.split || 0.5) ? 'A' : 'B';
  }

  const targetUrl = variant === 'A' ? domainConfig.urlA : domainConfig.urlB;
  
  // Use rewrite to serve content from targetUrl without changing browser URL
  const response = NextResponse.rewrite(new URL(targetUrl + request.nextUrl.pathname + request.nextUrl.search));

  // Save selection in a cookie
  response.cookies.set(cookieName, variant, {
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return response;
}
