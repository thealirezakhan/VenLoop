import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/patients", "/check-ins", "/alerts", "/cases", "/admin", "/demo/call-simulator"];

/**
 * Optimistic session gate (Next 16 proxy). Real authorization always happens
 * server-side in routes and RLS — this only keeps anonymous users out early.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSessionCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
  if (!hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/patients/:path*", "/check-ins/:path*", "/alerts/:path*", "/cases/:path*", "/admin/:path*", "/demo/call-simulator/:path*"],
};
