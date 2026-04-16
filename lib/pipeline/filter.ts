/**
 * LeadFlow pipeline · Stage 2 — Filtering
 *
 * Takes an array of channels_cache row IDs (from the discovery stage) and
 * applies every ICP filter in-memory:
 *
 *   1. subscriber_count within [min_subscribers, max_subscribers]
 *   2. avg_views >= min_views_avg
 *   3. If must_have_link_in_bio: links_in_bio array must be non-empty
 *   4. youtube_channel_id NOT in icp.excluded_channels
 *   5. No existing leads row for this user + channel (never re-deliver)
 *   6. last_video_date within the last 60 days (active channel check)
 *
 * Returns the subset of channels_cache IDs that pass all filters.
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { IcpProfile } from "@/lib/pipeline/discovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the columns we SELECT from channels_cache for filtering. */
type CachedChannel = {
  id: string;
  youtube_channel_id: string;
  subscriber_count: number | null;
  avg_views: number | null;
  links_in_bio: string[] | null;
  last_video_date: string | null;
};

type FilterResult = {
  /** channels_cache IDs that passed all filters. */
  passed: string[];
  /** Per-filter drop counts for logging. */
  stats: {
    input: number;
    droppedSubscribers: number;
    droppedViews: number;
    droppedLinkInBio: number;
    droppedExcluded: number;
    droppedAlreadyDelivered: number;
    droppedInactive: number;
    output: number;
  };
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const ACTIVE_CHANNEL_DAYS = 60;
const CHANNEL_BATCH_SIZE = 100; // Supabase .in() safe limit

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function filterChannels(
  channelCacheIds: string[],
  icp: IcpProfile,
  userId: string,
): Promise<FilterResult> {
  const stats = {
    input: channelCacheIds.length,
    droppedSubscribers: 0,
    droppedViews: 0,
    droppedLinkInBio: 0,
    droppedExcluded: 0,
    droppedAlreadyDelivered: 0,
    droppedInactive: 0,
    output: 0,
  };

  if (channelCacheIds.length === 0) {
    return { passed: [], stats };
  }

  const supabase = createServiceClient();

  // ----- Fetch channel rows in batches -----
  const channels: CachedChannel[] = [];
  for (let i = 0; i < channelCacheIds.length; i += CHANNEL_BATCH_SIZE) {
    const batch = channelCacheIds.slice(i, i + CHANNEL_BATCH_SIZE);
    const { data, error } = await supabase
      .from("channels_cache")
      .select(
        "id, youtube_channel_id, subscriber_count, avg_views, links_in_bio, last_video_date",
      )
      .in("id", batch);

    if (error) {
      console.error("[filter] channels_cache fetch failed:", error.message);
      continue;
    }
    if (data) channels.push(...(data as CachedChannel[]));
  }

  // ----- Build lookup sets -----
  const excludedSet = new Set(icp.excluded_channels ?? []);

  const activeCutoff = new Date(
    Date.now() - ACTIVE_CHANNEL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ----- Apply deterministic filters -----
  const afterLocal: CachedChannel[] = [];

  for (const ch of channels) {
    // 1. Subscriber range
    const subs = ch.subscriber_count ?? 0;
    if (subs < icp.min_subscribers || subs > icp.max_subscribers) {
      stats.droppedSubscribers++;
      continue;
    }

    // 2. Minimum average views
    const views = ch.avg_views ?? 0;
    if (views < icp.min_views_avg) {
      stats.droppedViews++;
      continue;
    }

    // 3. Link-in-bio requirement
    if (icp.must_have_link_in_bio) {
      const links = ch.links_in_bio ?? [];
      if (links.length === 0) {
        stats.droppedLinkInBio++;
        continue;
      }
    }

    // 4. Excluded channels
    if (excludedSet.has(ch.youtube_channel_id)) {
      stats.droppedExcluded++;
      continue;
    }

    // 5. Active channel check (last upload within ACTIVE_CHANNEL_DAYS)
    if (!ch.last_video_date || ch.last_video_date < activeCutoff) {
      stats.droppedInactive++;
      continue;
    }

    afterLocal.push(ch);
  }

  if (afterLocal.length === 0) {
    stats.output = 0;
    logStats(stats);
    return { passed: [], stats };
  }

  // ----- De-duplicate against already-delivered leads (DB check) -----
  const candidateIds = afterLocal.map((ch) => ch.id);
  const alreadyDeliveredIds = new Set<string>();

  for (let i = 0; i < candidateIds.length; i += CHANNEL_BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + CHANNEL_BATCH_SIZE);
    const { data, error } = await supabase
      .from("leads")
      .select("channel_id")
      .eq("user_id", userId)
      .in("channel_id", batch);

    if (error) {
      console.error("[filter] leads dedup query failed:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      alreadyDeliveredIds.add((row as { channel_id: string }).channel_id);
    }
  }

  const passed: string[] = [];
  for (const ch of afterLocal) {
    if (alreadyDeliveredIds.has(ch.id)) {
      stats.droppedAlreadyDelivered++;
    } else {
      passed.push(ch.id);
    }
  }

  stats.output = passed.length;
  logStats(stats);
  return { passed, stats };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logStats(s: FilterResult["stats"]): void {
  console.log(
    `[filter] ${s.input} candidates → ${s.output} passed | ` +
      `dropped: subs=${s.droppedSubscribers} views=${s.droppedViews} ` +
      `bio=${s.droppedLinkInBio} excluded=${s.droppedExcluded} ` +
      `delivered=${s.droppedAlreadyDelivered} inactive=${s.droppedInactive}`,
  );
}
