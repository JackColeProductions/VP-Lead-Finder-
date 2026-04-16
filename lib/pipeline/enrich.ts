/**
 * LeadFlow pipeline · Stage 3 — Enrichment
 *
 * For each channel in the batch whose `enriched_at` is NULL or stale
 * (older than 7 days), extracts:
 *
 *   1. **Email** — regex scan of the channel description for email addresses,
 *      with awareness of preamble phrases ("business inquiries:", "email me
 *      at", "contact:", etc.). Stores the first valid match.
 *
 *   2. **Instagram** — scans `links_in_bio` for instagram.com URLs and the
 *      description for @handle patterns (filtering out noise like @youtube,
 *      @gmail). Stores handle + URL.
 *
 *   3. **Commerce / link-in-bio signals** — checks links against an expanded
 *      list of known commerce and monetization platforms. Updates `has_website`
 *      and `has_merch`.
 *
 *   4. Sets `enriched_at = now()`.
 *
 * Errors are caught per-channel so one failure never kills the batch.
 */

import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Columns we SELECT from channels_cache for enrichment. */
type ChannelRow = {
  id: string;
  youtube_channel_id: string;
  description: string | null;
  links_in_bio: string[] | null;
  email_found: string | null;
  instagram_handle: string | null;
  instagram_url: string | null;
  has_website: boolean;
  has_merch: boolean;
  enriched_at: string | null;
};

type EnrichmentPatch = {
  email_found?: string | null;
  instagram_handle?: string | null;
  instagram_url?: string | null;
  has_website?: boolean;
  has_merch?: boolean;
  enriched_at: string;
};

export type EnrichResult = {
  processed: number;
  skippedFresh: number;
  emailsFound: number;
  instagramsFound: number;
  errors: number;
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const ENRICH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function enrichChannels(
  channelCacheIds: string[],
): Promise<EnrichResult> {
  const result: EnrichResult = {
    processed: 0,
    skippedFresh: 0,
    emailsFound: 0,
    instagramsFound: 0,
    errors: 0,
  };

  if (channelCacheIds.length === 0) return result;

  const supabase = createServiceClient();

  // Fetch rows in batches.
  const rows: ChannelRow[] = [];
  for (let i = 0; i < channelCacheIds.length; i += BATCH_SIZE) {
    const batch = channelCacheIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("channels_cache")
      .select(
        "id, youtube_channel_id, description, links_in_bio, email_found, " +
          "instagram_handle, instagram_url, has_website, has_merch, enriched_at",
      )
      .in("id", batch);

    if (error) {
      console.error("[enrich] channels_cache fetch failed:", error.message);
      result.errors++;
      continue;
    }
    if (data) rows.push(...(data as ChannelRow[]));
  }

  const enrichCutoff = new Date(Date.now() - ENRICH_TTL_MS).toISOString();

  for (const row of rows) {
    // Skip rows that were enriched recently.
    if (row.enriched_at && row.enriched_at >= enrichCutoff) {
      result.skippedFresh++;
      continue;
    }

    try {
      const patch = enrichSingleChannel(row);

      const { error: updateErr } = await supabase
        .from("channels_cache")
        .update(patch)
        .eq("id", row.id);

      if (updateErr) {
        console.error(
          `[enrich] update failed for ${row.youtube_channel_id}:`,
          updateErr.message,
        );
        result.errors++;
        continue;
      }

      result.processed++;
      if (patch.email_found) result.emailsFound++;
      if (patch.instagram_handle) result.instagramsFound++;
    } catch (e) {
      console.error(
        `[enrich] failed for ${row.youtube_channel_id}:`,
        e instanceof Error ? e.message : e,
      );
      result.errors++;
    }
  }

  console.log(
    `[enrich] processed=${result.processed} skipped=${result.skippedFresh} ` +
      `emails=${result.emailsFound} instagrams=${result.instagramsFound} ` +
      `errors=${result.errors}`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Per-channel enrichment (pure — no I/O)
// ---------------------------------------------------------------------------

function enrichSingleChannel(row: ChannelRow): EnrichmentPatch {
  const description = row.description ?? "";
  const links = row.links_in_bio ?? [];

  const email = extractEmail(description);
  const instagram = extractInstagram(description, links);
  const { hasWebsite, hasMerch } = detectCommerce(links);

  return {
    email_found: email,
    instagram_handle: instagram.handle,
    instagram_url: instagram.url,
    has_website: hasWebsite,
    has_merch: hasMerch,
    enriched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Email extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the first credible email address from a YouTube channel
 * description. Prioritises addresses preceded by common preamble phrases
 * ("business inquiries:", "email me at", "contact:", etc.), then falls back
 * to a raw email regex scan.
 *
 * Returns `null` when nothing credible is found.
 */
function extractEmail(text: string): string | null {
  if (!text) return null;

  // Normalise whitespace for matching.
  const normalised = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");

  // 1. Preamble-anchored extraction — highest confidence.
  const preamblePattern =
    /(?:business\s*(?:inquir(?:ies|y)|email)|contact(?:\s*(?:me|us))?|e[\s-]?mail(?:\s*(?:me|us))?|reach(?:\s*(?:me|us))?|get\s*in\s*touch|for\s*(?:collabs?|sponsorships?|partnerships?|bookings?))\s*(?:at|:|-|—|→|►|➜|➡|@)?\s*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/i;
  const preambleMatch = normalised.match(preamblePattern);
  if (preambleMatch) {
    const candidate = cleanEmail(preambleMatch[1]);
    if (candidate && !isNoiseEmail(candidate)) return candidate;
  }

  // 2. General email regex — take the first non-noise hit.
  const generalPattern = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = generalPattern.exec(normalised)) !== null) {
    const candidate = cleanEmail(match[0]);
    if (candidate && !isNoiseEmail(candidate)) return candidate;
  }

  return null;
}

/** Strip trailing dots/commas that the regex might have caught. */
function cleanEmail(raw: string): string | null {
  const cleaned = raw.replace(/[.,;:!?]+$/, "").toLowerCase();
  // Quick sanity: must contain exactly one @, domain has at least one dot.
  const parts = cleaned.split("@");
  if (parts.length !== 2) return null;
  if (!parts[1].includes(".")) return null;
  if (parts[0].length === 0 || parts[1].length < 3) return null;
  return cleaned;
}

/** Filter out emails that are clearly not contact addresses. */
function isNoiseEmail(email: string): boolean {
  const noisePatterns = [
    // Generic platform addresses
    /^(no-?reply|support|info|admin|help|mailer-daemon|postmaster)@/i,
    // Example/placeholder domains
    /@example\.(com|org|net)$/i,
    /@(gmail|yahoo|outlook|hotmail|aol|icloud|proton(mail)?)\.(com|co\.\w+)$/i,
  ];

  // Drop hits that look like common webmail domains — these are almost
  // never a creator's business email when found in a description.
  // EXCEPT: many small creators *do* use gmail as their business contact,
  // so we only filter if the local part looks auto-generated.
  // Actually, keep it simple: real business emails on gmail ARE valid leads.
  // Only filter obvious non-contact patterns.
  return noisePatterns.slice(0, 2).some((re) => re.test(email));
}

// ---------------------------------------------------------------------------
// Instagram extraction
// ---------------------------------------------------------------------------

type InstagramResult = {
  handle: string | null;
  url: string | null;
};

/**
 * Tries to find an Instagram handle and URL from a combination of the
 * channel's links_in_bio array and the description text.
 */
function extractInstagram(
  description: string,
  links: string[],
): InstagramResult {
  const empty: InstagramResult = { handle: null, url: null };

  // 1. Scan links_in_bio for instagram.com URLs.
  for (const link of links) {
    const handle = extractHandleFromInstagramUrl(link);
    if (handle) {
      return {
        handle,
        url: `https://www.instagram.com/${handle}/`,
      };
    }
  }

  // 2. Scan description for instagram.com URLs.
  const urlPattern = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(description)) !== null) {
    const handle = normaliseIgHandle(match[1]);
    if (handle) {
      return {
        handle,
        url: `https://www.instagram.com/${handle}/`,
      };
    }
  }

  // 3. Scan description for @handle patterns.
  //    Filter out noise handles that clearly aren't Instagram.
  const atPattern =
    /(?:instagram|ig|insta)\s*(?::|—|-|→|►|➜|➡)?\s*@([A-Za-z0-9_.]{1,30})/gi;
  while ((match = atPattern.exec(description)) !== null) {
    const handle = normaliseIgHandle(match[1]);
    if (handle) {
      return {
        handle,
        url: `https://www.instagram.com/${handle}/`,
      };
    }
  }

  // 4. Bare @handle near an instagram keyword (already covered above),
  //    or standalone @handle — too noisy to use without context, so skip.

  return empty;
}

/**
 * Given a URL, if it's an instagram.com profile link extract the handle.
 * Returns null for non-IG URLs or IG pages that aren't profiles.
 */
function extractHandleFromInstagramUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?/i,
  );
  if (!match) return null;
  return normaliseIgHandle(match[1]);
}

const IG_NON_PROFILE_SLUGS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "about",
  "directory",
  "legal",
  "developer",
  "tv",
]);

const NOISE_HANDLES = new Set([
  "youtube",
  "gmail",
  "gmail.com",
  "yahoo",
  "hotmail",
  "outlook",
  "email",
  "twitter",
  "tiktok",
  "facebook",
  "twitch",
  "discord",
  "snapchat",
]);

function normaliseIgHandle(raw: string): string | null {
  const handle = raw.replace(/\/+$/, "").toLowerCase();
  if (!handle || handle.length < 2) return null;
  if (IG_NON_PROFILE_SLUGS.has(handle)) return null;
  if (NOISE_HANDLES.has(handle)) return null;
  // Must look like a valid IG handle (letters, numbers, dots, underscores).
  if (!/^[a-z0-9_.]{1,30}$/.test(handle)) return null;
  return handle;
}

// ---------------------------------------------------------------------------
// Commerce / link-in-bio detection
// ---------------------------------------------------------------------------

/**
 * Expanded version of the commerce check from the discovery stage.
 * The discovery stage does a rough pass during channel ingestion; this stage
 * runs the definitive check with the full platform list from the spec.
 */
function detectCommerce(links: string[]): {
  hasWebsite: boolean;
  hasMerch: boolean;
} {
  const socialPattern =
    /(?:\/\/)(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com|discord\.gg|t\.me|twitch\.tv|reddit\.com|threads\.net)/i;

  // Full list from the spec, plus the patterns the discovery stage already
  // had, so the two stages are consistent.
  const commercePattern =
    /gumroad\.com|shopify|stan\.store|beacons\.ai|linktr\.ee|ko-fi\.com|patreon\.com|etsy\.com|teachable\.com|kajabi\.com|whop\.com|skool\.com|maven\.com|podia\.com|thinkific\.com|circle\.so|buy\.stripe\.com|teespring|spreadshop|bigcartel|buymeacoffee|(?:\/\/[^/]*(?:shop|store|merch))/i;

  let hasWebsite = false;
  let hasMerch = false;

  for (const link of links) {
    if (!socialPattern.test(link)) hasWebsite = true;
    if (commercePattern.test(link)) hasMerch = true;
  }

  return { hasWebsite, hasMerch };
}
