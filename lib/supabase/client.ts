import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for use in Client Components.
 * Uses the public anon key; all access is gated by RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
