import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './lib/env';

// Next 16 Proxy (formerly Middleware). Refreshes the Supabase session cookie on
// every request and gates the protected surfaces: unauthenticated users hitting an
// admin route are redirected to /login. Fine-grained role checks (SM-vs-HM/BM for
// leave/rotor) are enforced in-page so the §2.6 "leave-unauthorized" notice renders
// rather than redirects.
const PROTECTED_PREFIXES = ['/schedule-builder', '/admin', '/home'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims(), not getUser(). Both are safe on the server — getClaims verifies the
  // access token's signature rather than trusting it — but getUser() is an HTTP round
  // trip to GoTrue on EVERY request, measured at 100-150ms against the hosted project
  // (and multi-second when it is under load). This project signs with ES256, so
  // getClaims verifies locally against a JWKS it fetches once per process: ~3-6ms.
  // Session refresh still happens underneath (getClaims reads the session first, which
  // renews an expired token and writes the refreshed cookie through setAll above).
  const { data: claims } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (claims === null && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on everything except static assets and generated icons. The icon/manifest
  // routes were previously matched, so every favicon or PWA-manifest request paid a
  // full session check before serving a static byte stream.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)).*)',
  ],
};
