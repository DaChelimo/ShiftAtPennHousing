import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './lib/env';

// Next 16 Proxy (formerly Middleware). Refreshes the Supabase session cookie on
// every request and gates the protected surfaces: unauthenticated users hitting an
// admin route are redirected to /login. Fine-grained role checks (SM-vs-HM/BM for
// leave/rotor) are enforced in-page so the §2.6 "leave-unauthorized" notice renders
// rather than redirects.
const PROTECTED_PREFIXES = ['/schedule-builder', '/admin', '/home', '/assistant'];

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (user === null && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on everything except static assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
};
