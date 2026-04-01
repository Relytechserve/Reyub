import { NextResponse } from "next/server";

import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const loggedIn = !!req.auth;
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/register");

  if (!loggedIn && pathname.startsWith("/dashboard")) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (loggedIn && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
