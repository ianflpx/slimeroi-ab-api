import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';
import { kv } from '@vercel/kv';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)',
  ],
};

interface Variant {
  name: string;
  url: string;
  split: number;
}

interface DomainConfig {
  urlA: string;
  urlB: string;
  split: number;
  variants?: Variant[];
}

export async function middleware(request: NextRequest, event: import('next/server').NextFetchEvent) {
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
  let targetUrl = '';

  if (!variant) {
    // Se não houver cookie, realiza o split
    if (domainConfig.variants && domainConfig.variants.length > 0) {
      // Split dinâmico para múltiplas variantes
      const random = Math.random() * 100;
      let cumulative = 0;
      for (const v of domainConfig.variants) {
        cumulative += v.split;
        if (random < cumulative) {
          variant = v.name;
          targetUrl = v.url;
          break;
        }
      }
      // Fallback para a última se algo der errado no cálculo
      if (!variant) {
        variant = domainConfig.variants[0].name;
        targetUrl = domainConfig.variants[0].url;
      }
    } else {
      // Split clássico A/B
      const random = Math.random();
      variant = random < (domainConfig.split || 0.5) ? 'A' : 'B';
      targetUrl = variant === 'A' ? domainConfig.urlA : domainConfig.urlB;
    }
  } else {
    // Se já tem cookie, define a URL alvo baseada no variant salvo
    if (domainConfig.variants && domainConfig.variants.length > 0) {
      const vConfig = domainConfig.variants.find((v: Variant) => v.name === variant);
      targetUrl = vConfig ? vConfig.url : domainConfig.urlA;
    } else {
      targetUrl = variant === 'A' ? domainConfig.urlA : domainConfig.urlB;
    }
  }

  // --- LÓGICA DE MÉTRICAS (REDIS/KV) ---
  // Verifica se é um prefetch para não contar clique duplo invisível
  const isPrefetch =
    request.headers.get('x-purpose') === 'prefetch' ||
    request.headers.get('sec-purpose') === 'prefetch' ||
    request.headers.get('x-middleware-prefetch') === '1';

  // Verifica se o usuário já engatilhou um clique nos últimos 10 segundos
  // Isso previne contagens duplicadas geradas por redirecionamentos 301/302 do site destino
  const debounceCookieName = `sr_debounce_${safeKey}`;
  const isDebounced = request.cookies.has(debounceCookieName);

  if (request.method === 'GET' && !isPrefetch && !isDebounced) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const ip = (request as any).ip || request.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';

      // Incrementa cliques totais e por variante
      const pipeline = kv.pipeline();

      // Cliques diários
      pipeline.incr(`metrics:${safeKey}:${variant}:clicks:daily:${date}`);
      pipeline.incr(`metrics:${safeKey}:total:clicks:daily:${date}`);

      // Unicos diários (HyperLogLog)
      pipeline.pfadd(`metrics:${safeKey}:${variant}:uniques:daily:${date}`, ip);
      pipeline.pfadd(`metrics:${safeKey}:total:uniques:daily:${date}`, ip);

      // Expira as chaves após 90 dias
      pipeline.expire(`metrics:${safeKey}:${variant}:clicks:daily:${date}`, 60 * 60 * 24 * 90);
      pipeline.expire(`metrics:${safeKey}:total:clicks:daily:${date}`, 60 * 60 * 24 * 90);
      pipeline.expire(`metrics:${safeKey}:${variant}:uniques:daily:${date}`, 60 * 60 * 24 * 90);
      pipeline.expire(`metrics:${safeKey}:total:uniques:daily:${date}`, 60 * 60 * 24 * 90);

      event.waitUntil(
        pipeline.exec().catch((metricsError: any) => {
          console.error('Metrics Error:', metricsError);
        })
      );
    } catch (metricsError) {
      console.error('Metrics Error (Sync):', metricsError);
    }
  }
  // -------------------------------------

  // Mantém a URL original no navegador (Rewrite) e preserva path e UTMs
  const finalTarget = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : targetUrl;
  const urlWithParams = new URL(finalTarget + request.nextUrl.pathname + request.nextUrl.search);

  const response = NextResponse.rewrite(urlWithParams);

  // Salva a variante no cookie para manter a consistência do teste
  response.cookies.set(cookieName, variant as string, {
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: '/',
    sameSite: 'lax',
  });

  // Salva o cookie de debounce (evita duplo clique por 10 segundos)
  response.cookies.set(debounceCookieName, '1', {
    maxAge: 10,
    path: '/',
    sameSite: 'lax',
  });

  return response;
}

