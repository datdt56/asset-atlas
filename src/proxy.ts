import { NextResponse, type NextRequest } from "next/server";
import { authenticate, passwordRequired } from "./server/auth";

// Native browser sign-in for a private production demo; the API also checks authorization.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "development" || !process.env.APP_PASSWORD)
    return NextResponse.next();
  return authenticate(request, process.env)
    ? NextResponse.next()
    : passwordRequired();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
