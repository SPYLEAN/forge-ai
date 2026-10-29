import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresh the Supabase session cookie once per navigation, so server routes see a
 * valid token. It does nothing in local mode (no Supabase env).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  // If this site's /auth/callback isn't in Supabase's Redirect URLs allow list, Supabase
  // sends the magic link to the Site URL instead (e.g. "/?code=…"). Route it to the
  // callback so the sign-in still completes.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/auth/callback" && !pathname.startsWith("/api/") && searchParams.has("code")) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/callback";
    return NextResponse.redirect(target);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Skip static assets and the image optimizer.
  matcher: ["/((?!_next/static|_next/image|icon.png|forge-mark.png).*)"],
};
