// Data Transformation (02X) — post_metrics: deduped + light enrichment.
// Source: 01X dl.post_metrics_raw (already enriched with country/network/username
// at ingest time via profile_router.py).
//
// Transformations:
//   1. Dedup by (post_id, ingest_date) — keep latest record by _ingested_at
//   2. Derive published_date = DATE(created_at)
//   3. Extract campaign_tag from copy (#VISA<TAG> regex)
//   4. (Pass through) country, network, username, region from dl

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dlDataset = datasetFor("dl", region);

  publish("post_metrics", {
    schema: datasetFor("dt", region),
    type: "table",
    description: `Deduped per-post snapshot — ${region.toUpperCase()}. JOIN-ready for warehouse.`,
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
  -- content
  format,
  copy,
  source_link,
  REGEXP_EXTRACT(copy, r"#(VISA[A-Z0-9_]+)") AS campaign_tag,
  -- counter metrics (latest snapshot values)
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
  -- rate / time metrics
  engagement_rate,
  roi,
  ig_reels_avg_watch_time,
  ig_reels_video_view_total_time,
  average_time_watched,
  total_time_watched,
  full_video_watched_rate,
  -- audit
  CURRENT_TIMESTAMP() AS _loaded_at
FROM dedup
`
  );
});
