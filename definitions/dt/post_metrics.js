// Data Transformation (02X) — post_metrics: deduped per (post_id, ingest_date) + LAG-based deltas.
// Source: 01X dl.post_metrics_raw (already enriched with country/network/username
// at ingest time via profile_router.py).
//
// Transformations:
//   1. Dedup by (post_id, ingest_date) — keep latest record by _ingested_at
//   2. Compute LAG(metric) OVER (PARTITION BY post_id ORDER BY ingest_date)
//      for 11 cumulative metrics to derive *_delta columns
//   3. Compute days_since_prev = DATE_DIFF(ingest_date, prev_ingest_date)
//   4. Flag is_initial_snapshot for the first row per post (no LAG predecessor)
//   5. Derive published_date = DATE(created_at)
//   6. Extract campaign_tag from copy (#VISA<TAG> regex)
//   7. (Pass through) country, network, username, region from dl
//
// IMPORTANT — semantic shift:
//   * Cumulative columns (reach, views, likes, ...) remain as Hootsuite returns
//     them: state-at-snapshot-time. Useful for "current state of a post".
//   * *_delta columns are incremental: "gained between prev snapshot and this one".
//     Use these for any aggregation across time (SUM by week, etc.).

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dlDataset = datasetFor("dl", region);

  publish("post_metrics", {
    schema: datasetFor("dt", region),
    type: "table",
    description: `Deduped per-post snapshots with LAG-based deltas — ${region.toUpperCase()}.`,
    bigquery: {
      partitionBy: "ingest_date",
      clusterBy: ["network", "country", "profile_id"],
    },
  }).query(
    (ctx) => `
WITH dedup AS (
  SELECT * EXCEPT(_rn) FROM (
    SELECT
      *,
      ROW_NUMBER() OVER (PARTITION BY post_id, ingest_date ORDER BY _ingested_at DESC) AS _rn
    FROM ${ctx.ref({ schema: dlDataset, name: "post_metrics_raw" })}
  ) WHERE _rn = 1
),
with_lag AS (
  SELECT
    *,
    LAG(ingest_date)      OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_ingest_date,
    LAG(reach)            OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_reach,
    LAG(views)            OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_views,
    LAG(video_views)      OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_video_views,
    LAG(comments)         OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_comments,
    LAG(likes)            OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_likes,
    LAG(shares)           OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_shares,
    LAG(saves)            OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_saves,
    LAG(engagement)       OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_engagement,
    LAG(follows)          OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_follows,
    LAG(profile_visits)   OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_profile_visits,
    LAG(profile_activity) OVER (PARTITION BY post_id ORDER BY ingest_date) AS prev_profile_activity
  FROM dedup
)
SELECT
  -- identity (from ingest-time enrichment)
  post_id,
  profile_id,
  social_network_id,
  username,
  country,
  network,
  region,
  -- temporal
  created_at,
  DATE(created_at) AS published_date,
  ingest_date,
  ingest_date AS fact_date,
  prev_ingest_date,
  DATE_DIFF(ingest_date, prev_ingest_date, DAY) AS days_since_prev,
  prev_ingest_date IS NULL AS is_initial_snapshot,
  -- content
  format,
  copy,
  source_link,
  thumbnail_url,
  REGEXP_EXTRACT(copy, r"#(VISA[A-Z0-9_]+)") AS campaign_tag,
  -- cumulative counters (state at snapshot time)
  comments,
  engagement,
  likes,
  reach,
  saves,
  shares,
  views,
  video_views,
  follows,
  exits,
  taps_back,
  taps_forward,
  profile_activity,
  profile_visits,
  posts_count,
  -- incremental deltas (gained between prev snapshot and this one)
  -- NULL for is_initial_snapshot = TRUE rows
  reach            - prev_reach            AS reach_delta,
  views            - prev_views            AS views_delta,
  video_views      - prev_video_views      AS video_views_delta,
  comments         - prev_comments         AS comments_delta,
  likes            - prev_likes            AS likes_delta,
  shares           - prev_shares           AS shares_delta,
  saves            - prev_saves            AS saves_delta,
  engagement       - prev_engagement       AS engagement_delta,
  follows          - prev_follows          AS follows_delta,
  profile_visits   - prev_profile_visits   AS profile_visits_delta,
  profile_activity - prev_profile_activity AS profile_activity_delta,
  -- rate / time metrics (passed through; do not delta — they are ratios)
  engagement_rate,
  roi,
  ig_reels_avg_watch_time,
  ig_reels_video_view_total_time,
  average_time_watched,
  total_time_watched,
  full_video_watched_rate,
  -- audit
  CURRENT_TIMESTAMP() AS _loaded_at
FROM with_lag
`
  );
});
