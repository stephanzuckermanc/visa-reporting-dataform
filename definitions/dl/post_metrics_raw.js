// Data Lake (01X) — post_metrics_raw: first parse of ext_post_metrics.
// One row per record, no dedup. Region encoded in dataset name.
// Ingest writes country/network/username/region into each NDJSON row
// (see services/hootsuite-ingest/app.py::_flatten_post_metrics), so we
// just project them through here.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("post_metrics_raw", {
    schema: datasetFor("dl", region),
    type: "table",
    description: `First-parse of ext_post_metrics — ${region.toUpperCase()}. Per-post Analytics API output.`,
    bigquery: {
      partitionBy: "ingest_date",
      clusterBy: ["network", "profile_id"],
    },
  }).query(
    (ctx) => `
SELECT
  -- identity (denormalized at ingest time from /v1/socialProfiles)
  country,
  network,
  username,
  profile_id,
  social_network_id,
  -- post identity
  post_id,
  created_at,
  format,
  copy,
  source_link,
  -- core engagement counters
  SAFE_CAST(comments AS INT64)         AS comments,
  SAFE_CAST(engagement AS INT64)       AS engagement,
  SAFE_CAST(likes AS INT64)            AS likes,
  SAFE_CAST(reach AS INT64)            AS reach,
  SAFE_CAST(saves AS INT64)            AS saves,
  SAFE_CAST(shares AS INT64)           AS shares,
  SAFE_CAST(views AS INT64)            AS views,
  SAFE_CAST(video_views AS INT64)      AS video_views,
  SAFE_CAST(follows AS INT64)          AS follows,
  SAFE_CAST(exits AS INT64)            AS exits,
  SAFE_CAST(taps_back AS INT64)        AS taps_back,
  SAFE_CAST(taps_forward AS INT64)     AS taps_forward,
  SAFE_CAST(profile_activity AS INT64) AS profile_activity,
  SAFE_CAST(profile_visits AS INT64)   AS profile_visits,
  SAFE_CAST(posts_count AS INT64)      AS posts_count,
  -- rates / time metrics
  SAFE_CAST(engagement_rate AS FLOAT64)                AS engagement_rate,
  SAFE_CAST(roi AS FLOAT64)                            AS roi,
  SAFE_CAST(ig_reels_avg_watch_time AS FLOAT64)        AS ig_reels_avg_watch_time,
  SAFE_CAST(ig_reels_video_view_total_time AS FLOAT64) AS ig_reels_video_view_total_time,
  SAFE_CAST(average_time_watched AS FLOAT64)           AS average_time_watched,
  SAFE_CAST(total_time_watched AS FLOAT64)             AS total_time_watched,
  SAFE_CAST(full_video_watched_rate AS FLOAT64)        AS full_video_watched_rate,
  -- routing
  region,
  -- audit (dt comes from hive partitioning typed DATE; _ingested_at typed TIMESTAMP by ext schema)
  dt AS ingest_date,
  _ingested_at
FROM ${ctx.ref({ schema: datasetFor("dp", region), name: "ext_post_metrics" })}
`
  );
});
