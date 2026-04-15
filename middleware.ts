import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all routes except:
     * - _next/static (static assets)
     * - _next/image (optimized images)
     * - favicon and common image extensions
     *
     * Auth pages still run through middleware so the session is always
     * fresh when a logged-in user hits /login (letting us redirect them).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
