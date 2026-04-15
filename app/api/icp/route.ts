import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_USER_ID } from "@/lib/constants";

/**
 * /api/icp — GET returns the ICP profile for the default user, POST upserts it.
 *
 * No auth: this is a single-user local tool. The service-role client bypasses
 * RLS entirely, so the hardcoded DEFAULT_USER_ID is the only "identity".
 */

export const runtime = "nodejs";

type IcpPayload = {
  niches?: unknown;
  keywords?: unknown;
  min_subscribers?: unknown;
  max_subscribers?: unknown;
  min_views_avg?: unknown;
  languages?: unknown;
  must_have_link_in_bio?: unknown;
  must_have_email?: unknown;
  must_have_instagram?: unknown;
  excluded_channels?: unknown;
};

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    const t = item.trim();
    if (t) out.push(t);
  }
  return out;
}

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("icp_profiles")
    .select("*")
    .eq("user_id", DEFAULT_USER_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ icp: data });
}

export async function POST(request: Request) {
  let body: IcpPayload;
  try {
    body = (await request.json()) as IcpPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const niches = asStringArray(body.niches);
  const keywords = asStringArray(body.keywords);

  if (!niches || niches.length === 0) {
    return NextResponse.json(
      { error: "At least one niche is required." },
      { status: 400 },
    );
  }
  if (!keywords || keywords.length === 0) {
    return NextResponse.json(
      { error: "At least one keyword is required." },
      { status: 400 },
    );
  }

  const languages = asStringArray(body.languages) ?? ["en"];
  const minSubs = Number(body.min_subscribers ?? 1000);
  const maxSubs = Number(body.max_subscribers ?? 500_000);
  const minViews = Number(body.min_views_avg ?? 1000);

  if (
    !Number.isFinite(minSubs) ||
    !Number.isFinite(maxSubs) ||
    !Number.isFinite(minViews) ||
    minSubs < 0 ||
    maxSubs <= minSubs
  ) {
    return NextResponse.json(
      { error: "Invalid subscriber range or minimum views." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  const { error: upsertError } = await supabase.from("icp_profiles").upsert(
    {
      user_id: DEFAULT_USER_ID,
      niches,
      keywords,
      min_subscribers: Math.round(minSubs),
      max_subscribers: Math.round(maxSubs),
      min_views_avg: Math.round(minViews),
      languages,
      must_have_link_in_bio: Boolean(body.must_have_link_in_bio ?? true),
      must_have_email: Boolean(body.must_have_email ?? true),
      must_have_instagram: Boolean(body.must_have_instagram ?? false),
      excluded_channels: asStringArray(body.excluded_channels) ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true })
    .eq("id", DEFAULT_USER_ID);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
