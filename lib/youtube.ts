/**
 * YouTube Data API v3 wrapper.
 *
 * Thin fetch-based client (no SDK) with full TypeScript types for the response
 * shapes we actually consume. Tracks daily quota usage in-memory and warns
 * when approaching the default 10,000 unit/day limit.
 *
 * Quota costs (per call):
 *   - search.list          → 100 units
 *   - channels.list        →   1 unit
 *   - playlistItems.list   →   1 unit
 *   - videos.list          →   1 unit
 *
 * Note: the in-memory counter resets on cold starts. That's fine for a local
 * single-user tool — a real production service should persist this in Redis
 * or a DB row keyed by day.
 */

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const DAILY_QUOTA = 10_000;
const QUOTA_WARN_RATIO = 0.8;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export type YouTubeThumbnails = {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
};

export type YouTubeChannel = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
    country?: string;
    defaultLanguage?: string;
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  brandingSettings?: {
    channel?: {
      title?: string;
      description?: string;
      keywords?: string;
      country?: string;
    };
    image?: {
      bannerExternalUrl?: string;
    };
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
      likes?: string;
    };
  };
};

export type YouTubeSearchResultItem = {
  kind: string;
  id: {
    kind: "youtube#video" | "youtube#channel" | "youtube#playlist";
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: YouTubeThumbnails;
    channelTitle: string;
  };
};

export type YouTubeVideo = {
  id: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
    channelTitle?: string;
    tags?: string[];
    categoryId?: string;
    defaultLanguage?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    favoriteCount?: string;
  };
};

export type YouTubePlaylistItem = {
  id: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    resourceId?: {
      kind?: string;
      videoId?: string;
    };
  };
};

type YouTubeListResponse<T> = {
  kind?: string;
  etag?: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items?: T[];
};

// ---------------------------------------------------------------------------
// Quota tracking
// ---------------------------------------------------------------------------

let quotaUsed = 0;
let quotaDate = todayKey();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function consumeQuota(units: number, operation: string): void {
  const today = todayKey();
  if (today !== quotaDate) {
    quotaDate = today;
    quotaUsed = 0;
  }
  if (quotaUsed + units > DAILY_QUOTA) {
    throw new Error(
      `YouTube daily quota would be exceeded (${quotaUsed + units}/${DAILY_QUOTA}) on ${operation}`,
    );
  }
  quotaUsed += units;
  if (quotaUsed >= DAILY_QUOTA * QUOTA_WARN_RATIO) {
    console.warn(
      `[youtube] Quota at ${quotaUsed}/${DAILY_QUOTA} units after ${operation} — approaching daily limit`,
    );
  }
}

export function getYouTubeQuotaUsage(): {
  used: number;
  total: number;
  remaining: number;
  date: string;
} {
  if (todayKey() !== quotaDate) {
    quotaDate = todayKey();
    quotaUsed = 0;
  }
  return {
    used: quotaUsed,
    total: DAILY_QUOTA,
    remaining: Math.max(0, DAILY_QUOTA - quotaUsed),
    date: quotaDate,
  };
}

// ---------------------------------------------------------------------------
// Low-level fetch
// ---------------------------------------------------------------------------

async function ytFetch<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  quotaCost: number,
  operation: string,
): Promise<T> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }

  // Throws if the call would push us past the daily cap.
  consumeQuota(quotaCost, operation);

  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `YouTube API ${operation} failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for channels matching a query. Quota: 100 units per call.
 */
export async function searchChannels(
  query: string,
  maxResults = 10,
): Promise<YouTubeSearchResultItem[]> {
  const data = await ytFetch<YouTubeListResponse<YouTubeSearchResultItem>>(
    "/search",
    {
      part: "snippet",
      type: "channel",
      q: query,
      maxResults: Math.min(50, Math.max(1, maxResults)),
    },
    100,
    `searchChannels("${query}")`,
  );
  return data.items ?? [];
}

/**
 * Search for videos matching a query. Quota: 100 units per call.
 * Pass `order: "date"` to get freshly uploaded content first.
 */
export async function searchVideos(
  query: string,
  maxResults = 10,
  opts: {
    order?: "date" | "relevance" | "viewCount" | "rating" | "title";
    publishedAfter?: string;
    regionCode?: string;
    relevanceLanguage?: string;
  } = {},
): Promise<YouTubeSearchResultItem[]> {
  const data = await ytFetch<YouTubeListResponse<YouTubeSearchResultItem>>(
    "/search",
    {
      part: "snippet",
      type: "video",
      q: query,
      maxResults: Math.min(50, Math.max(1, maxResults)),
      order: opts.order,
      publishedAfter: opts.publishedAfter,
      regionCode: opts.regionCode,
      relevanceLanguage: opts.relevanceLanguage,
    },
    100,
    `searchVideos("${query}")`,
  );
  return data.items ?? [];
}

/**
 * Fetch full channel details for up to 50 channels per request.
 * Automatically batches larger input arrays.
 * Quota: 1 unit per call.
 */
export async function getChannelDetails(
  channelIds: string[],
): Promise<YouTubeChannel[]> {
  const unique = Array.from(new Set(channelIds.filter(Boolean)));
  if (unique.length === 0) return [];

  const results: YouTubeChannel[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const data = await ytFetch<YouTubeListResponse<YouTubeChannel>>(
      "/channels",
      {
        part: "snippet,statistics,brandingSettings,contentDetails",
        id: batch.join(","),
        maxResults: 50,
      },
      1,
      `getChannelDetails(batch of ${batch.length})`,
    );
    if (data.items) results.push(...data.items);
  }
  return results;
}

/**
 * Fetch the N most recent uploaded videos for a channel, with view/like
 * statistics. Costs 2 units total (playlistItems.list + videos.list).
 *
 * Uses the well-known "UC" → "UU" prefix swap to derive the uploads playlist
 * ID without an extra channels.list round-trip.
 */
export async function getChannelVideos(
  channelId: string,
  maxResults = 5,
): Promise<YouTubeVideo[]> {
  if (!channelId || !channelId.startsWith("UC")) {
    throw new Error(`Invalid channel ID: ${channelId}`);
  }
  const uploadsPlaylistId = "UU" + channelId.slice(2);

  const playlistData = await ytFetch<YouTubeListResponse<YouTubePlaylistItem>>(
    "/playlistItems",
    {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, Math.max(1, maxResults)),
    },
    1,
    `getChannelVideos.playlist(${channelId})`,
  );

  const videoIds = (playlistData.items ?? [])
    .map((item) => item.snippet?.resourceId?.videoId)
    .filter((id): id is string => Boolean(id));

  if (videoIds.length === 0) return [];

  const videoData = await ytFetch<YouTubeListResponse<YouTubeVideo>>(
    "/videos",
    {
      part: "snippet,statistics",
      id: videoIds.join(","),
      maxResults: videoIds.length,
    },
    1,
    `getChannelVideos.videos(${channelId})`,
  );

  return videoData.items ?? [];
}
