/**
 * LeadFlow pipeline · Stage 1 — Discovery
 *
 * Given an ICP profile, build a set of search queries, hit YouTube's channel
 * and video search endpoints, dedupe candidate channels, fetch full details
 * (with avg views from the last 5 uploads and extracted bio links), and
 * upsert everything into the shared `channels_cache` table.
 *
 * Returns the channels_cache row IDs (both freshly fetched and already-fresh
 * cache hits) so downstream pipeline stages can pick up where this left off.
 *
 * Error handling: every external call is wrapped in try/catch. One bad
 * channel or one failed query never takes down the whole run — we log and
 * move on.
 */

import { createServiceClient } from "@/lib/supabase/server";
import {
  searchChannels,
  searchVideos,
  getChannelDetails,
  getChannelVideos,
  type YouTubeChannel,
  type YouTubeVideo,
} from "@/lib/youtube";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of an `icp_profiles` row as consumed by the pipeline.
 * Defined here (rather than imported from a shared types file) because this
 * is the first pipeline stage that needs it.
 */
export type IcpProfile = {
  id: string;
  user_id: string;
  niches: string[];
  keywords: string[];
  min_subscribers: number;
  max_subscribers: number;
  min_views_avg: number;
  languages: string[];
  must_have_link_in_bio: boolean;
  must_have_email: boolean;
  must_have_instagram: boolean;
  excluded_channels: string[];
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_SEARCH_QUERIES = 5;
const RESULTS_PER_QUERY = 10;
const VIDEOS_PER_CHANNEL = 5;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function discoverChannels(icp: IcpProfile): Promise<string[]> {
  const supabase = createServiceClient();

  // 1. Build search queries from keywords × niches.
  const queries = buildSearchQueries(icp, MAX_SEARCH_QUERIES);
  if (queries.length === 0) {
    console.warn("[discovery] no search queries could be built from ICP");
    return [];
  }

  // 2. Collect candidate channel IDs from channel + video searches.
  const channelIdSet = new Set<string>();

  for (const query of queries) {
    try {
      const items = await searchChannels(query, RESULTS_PER_QUERY);
      for (const item of items) {
        if (item.id.channelId) channelIdSet.add(item.id.channelId);
      }
    } catch (e) {
      console.error(
        `[discovery] searchChannels("${query}") failed:`,
        errMsg(e),
      );
    }

    try {
      const items = await searchVideos(query, RESULTS_PER_QUERY, {
        order: "date",
      });
      for (const item of items) {
        // For video results, channelId lives on snippet, not id.
        if (item.snippet?.channelId) {
          channelIdSet.add(item.snippet.channelId);
        }
      }
    } catch (e) {
      console.error(
        `[discovery] searchVideos("${query}") failed:`,
        errMsg(e),
      );
    }
  }

  // 3. Drop explicitly excluded channels.
  for (const excluded of icp.excluded_channels ?? []) {
    channelIdSet.delete(excluded);
  }

  const allChannelIds = Array.from(channelIdSet);
  if (allChannelIds.length === 0) {
    console.warn("[discovery] no candidate channels found from search");
    return [];
  }

  // 4. Check which channels are already in the cache and still fresh.
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data: freshRows, error: cacheErr } = await supabase
    .from("channels_cache")
    .select("id, youtube_channel_id")
    .in("youtube_channel_id", allChannelIds)
    .gte("fetched_at", cutoff);

  if (cacheErr) {
    console.error(
      "[discovery] cache freshness query failed:",
      cacheErr.message,
    );
  }

  const fresh = (freshRows ?? []) as Array<{
    id: string;
    youtube_channel_id: string;
  }>;
  const freshYoutubeIds = new Set(fresh.map((r) => r.youtube_channel_id));
  const resultIds: string[] = fresh.map((r) => r.id);
  const toFetch = allChannelIds.filter((id) => !freshYoutubeIds.has(id));

  if (toFetch.length === 0) {
    return resultIds;
  }

  // 5. Fetch full details for non-cached / stale channels.
  let channels: YouTubeChannel[] = [];
  try {
    channels = await getChannelDetails(toFetch);
  } catch (e) {
    console.error("[discovery] getChannelDetails failed:", errMsg(e));
    return resultIds;
  }

  // 6. Per-channel: fetch recent videos, extract links, upsert.
  for (const channel of channels) {
    try {
      const rowId = await ingestChannel(supabase, channel);
      if (rowId) resultIds.push(rowId);
    } catch (e) {
      console.error(
        `[discovery] ingestChannel(${channel.id}) failed:`,
        errMsg(e),
      );
    }
  }

  return resultIds;
}

// ---------------------------------------------------------------------------
// Per-channel ingestion
// ---------------------------------------------------------------------------

async function ingestChannel(
  supabase: ReturnType<typeof createServiceClient>,
  channel: YouTubeChannel,
): Promise<string | null> {
  let avgViews = 0;
  let lastVideoDate: string | null = null;

  try {
    const videos = await getChannelVideos(channel.id, VIDEOS_PER_CHANNEL);
    if (videos.length > 0) {
      avgViews = calcAvgViews(videos);
      lastVideoDate = mostRecentVideoDate(videos);
    }
  } catch (e) {
    // Non-fatal — channel still worth caching even without video stats.
    console.error(
      `[discovery] getChannelVideos(${channel.id}) failed:`,
      errMsg(e),
    );
  }

  const descLinks = extractLinks(channel.snippet?.description ?? "");
  const brandingLinks = extractLinks(
    channel.brandingSettings?.channel?.description ?? "",
  );
  const links = Array.from(new Set([...descLinks, ...brandingLinks]));
  const { hasWebsite, hasMerch } = detectCommerce(links);

  const thumbnails = channel.snippet?.thumbnails;
  const profileImage =
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    null;

  const row = {
    youtube_channel_id: channel.id,
    channel_name: channel.snippet?.title ?? null,
    subscriber_count: toInt(channel.statistics?.subscriberCount),
    avg_views: avgViews,
    description: channel.snippet?.description ?? null,
    profile_image_url: profileImage,
    banner_url: channel.brandingSettings?.image?.bannerExternalUrl ?? null,
    links_in_bio: links,
    has_website: hasWebsite,
    has_merch: hasMerch,
    last_video_date: lastVideoDate,
    fetched_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("channels_cache")
    .upsert(row, { onConflict: "youtube_channel_id" })
    .select("id")
    .single();

  if (error) {
    console.error(
      `[discovery] upsert failed for ${channel.id}:`,
      error.message,
    );
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * Walk the keyword × niche cartesian product in row-major order and return
 * the first `limit` combinations. Falls back to just keywords or just niches
 * if one of them is empty.
 */
function buildSearchQueries(icp: IcpProfile, limit: number): string[] {
  const keywords = (icp.keywords ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const niches = (icp.niches ?? []).map((s) => s.trim()).filter(Boolean);

  if (keywords.length === 0 && niches.length === 0) return [];
  if (niches.length === 0) return keywords.slice(0, limit);
  if (keywords.length === 0) return niches.slice(0, limit);

  const queries: string[] = [];
  outer: for (const kw of keywords) {
    for (const n of niches) {
      queries.push(`${kw} ${n}`);
      if (queries.length >= limit) break outer;
    }
  }
  return queries;
}

// ---------------------------------------------------------------------------
// Video stat helpers
// ---------------------------------------------------------------------------

function calcAvgViews(videos: YouTubeVideo[]): number {
  const counts = videos
    .map((v) => toInt(v.statistics?.viewCount))
    .filter((n) => n > 0);
  if (counts.length === 0) return 0;
  return Math.round(counts.reduce((s, n) => s + n, 0) / counts.length);
}

function mostRecentVideoDate(videos: YouTubeVideo[]): string | null {
  let latest: string | null = null;
  for (const v of videos) {
    const d = v.snippet?.publishedAt;
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Link extraction + commerce detection
// ---------------------------------------------------------------------------

function extractLinks(text: string): string[] {
  if (!text) return [];
  // Grab anything that looks like a URL. Stop at whitespace, brackets, and
  // common string delimiters; then strip trailing sentence punctuation.
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlRegex) ?? [];
  return Array.from(
    new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, ""))),
  );
}

function detectCommerce(links: string[]): {
  hasWebsite: boolean;
  hasMerch: boolean;
} {
  // A "website" is any link that isn't a known social network.
  const socialPattern =
    /(?:\/\/)(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com|discord\.gg|t\.me|twitch\.tv|reddit\.com|threads\.net)/i;
  // Merch/commerce keywords or known storefront platforms.
  const merchPattern =
    /shop|store|merch|teespring|spreadshop|shopify|gumroad|patreon|ko-fi|buymeacoffee|bigcartel|etsy|stan\.store|beacons\.ai|linktr\.ee/i;

  let hasWebsite = false;
  let hasMerch = false;
  for (const link of links) {
    if (!socialPattern.test(link)) hasWebsite = true;
    if (merchPattern.test(link)) hasMerch = true;
  }
  return { hasWebsite, hasMerch };
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

function toInt(v: string | number | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
