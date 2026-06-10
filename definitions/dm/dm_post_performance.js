// Data Mart (04X) — dm_post_performance: one row per post with latest metrics + last-period deltas + derived rates.
// Source: 02X_dt.post_metrics. Takes the most recent snapshot per post.
// Computes derived KPIs (frequency, share_rate, save_rate, vtr_50) inline.
//
// Exposes BOTH cumulative columns (reach, views, ...) and last-period deltas
// (reach_delta, views_delta, ...) so the dashboard can answer:
//   - "Estado total del post X"      → use cumulative
//   - "Cuánto ganó esta semana el post X" → use *_delta

const { REGIONS, datasetFor, marketSQL } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dtDataset = datasetFor("dt", region);

  publish("dm_post_performance", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Per-post KPIs (cumulative + last delta) — ${region.toUpperCase()}.`,
    bigquery: {
      partitionBy: "published_date",
      clusterBy: ["network", "campaign_tag"],
    },
  }).query(
    (ctx) => `
WITH latest_per_post AS (
  SELECT * EXCEPT(_rn) FROM (
    SELECT
      *,
      ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY ingest_date DESC) AS _rn
    FROM ${ctx.ref({ schema: dtDataset, name: "post_metrics" })}
  ) WHERE _rn = 1
)
SELECT
  post_id,
  profile_id,
  username,
  network,
  country,
  region,
  ${marketSQL("country", "username")} AS market,
  created_at AS published_at,
  published_date,
  format,
  campaign_tag,
  source_link,
  copy,
  -- cumulative counters (state of the post right now)
  reach,
  views,
  video_views,
  comments,
  likes,
  shares,
  saves,
  engagement,
  follows,
  profile_visits,
  profile_activity,
  exits,
  taps_back,
  taps_forward,
  -- last-period deltas (what the post gained since the previous snapshot)
  -- NULL for posts with only one snapshot ever
  reach_delta,
  views_delta,
  video_views_delta,
  comments_delta,
  likes_delta,
  shares_delta,
  saves_delta,
  engagement_delta,
  follows_delta,
  profile_visits_delta,
  profile_activity_delta,
  days_since_prev,
  -- rate / time
  engagement_rate,
  roi,
  -- derived KPIs (over cumulative)
  SAFE_DIVIDE(views, reach)  AS frequency,
  SAFE_DIVIDE(shares, reach) AS share_rate,
  SAFE_DIVIDE(saves, reach)  AS save_rate,
  -- video
  ig_reels_avg_watch_time,
  ig_reels_video_view_total_time,
  average_time_watched,
  total_time_watched,
  full_video_watched_rate,
  -- VTR 50% proxy: use full_video_watched_rate for TikTok, otherwise NULL.
  CASE network
    WHEN 'TIKTOKBUSINESS' THEN full_video_watched_rate
    ELSE NULL
  END AS vtr_50
FROM latest_per_post
`
  );
});
