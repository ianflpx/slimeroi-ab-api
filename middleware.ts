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
  const domain = host.split(':')[0]; // Obtém o domínio sem a porta
  
  // CORREÇÃO: Converte pontos em underscores para coincidir com a chave salva no Edge Config
  const safeKey = domain.replace(/\./g, '_');

  // Tenta buscar a configuração para este domínio usando a chave segura
  const domainConfig = await get<DomainConfig>(safeKey);

  if (!domainConfig || !domainConfig.urlA || !domainConfig.urlB) {
    return NextResponse.next();
  }

  const cookieName = `sr_variant_${safeKey}`;
  let variant = request.cookies.get(cookieName)?.value;

  if (!variant) {
    // Se não houver cookie, realiza o split A/B
    const random = Math.random();
    variant = random < (domainConfig.split || 0.5) ? 'A' : 'B';
  }

  const targetUrl = variant === 'A' ? domainConfig.urlA : domainConfig.urlB;
  
  // Mantém a URL original no navegador (Rewrite) e preserva path e UTMs
  const response = NextResponse.rewrite(new URL(targetUrl + request.nextUrl.pathname + request.nextUrl.search));

  // Salva a variante no cookie para manter a consistência do teste
  response.cookies.set(cookieName, variant, {
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: '/',
  });

  return response;
}
