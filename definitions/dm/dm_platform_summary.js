// Data Mart (04X) — dm_platform_summary: aggregates per fact_date × network × country × campaign.
// Source: 02X_dt.post_metrics (deltas, not cumulatives).
// Replaces the previous dm_platform_summary_daily, which double-counted because
// it summed cumulative metrics across time. This version uses *_delta columns
// from DT, so SUMs across multiple fact_dates are mathematically correct.
//
// Cadence-agnostic: works whether the ingest runs daily, weekly, or sporadic.
// Use `avg_window_days` to detect cadence drift in QA.
//
// Initial snapshots (is_initial_snapshot = TRUE) are EXCLUDED — their deltas
// are NULL and they don't represent activity gained in any specific period.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dtDataset = datasetFor("dt", region);

  publish("dm_platform_summary", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Per-period aggregates (network × country × campaign) using deltas — ${region.toUpperCase()}.`,
    bigquery: {
      partitionBy: "fact_date",
      clusterBy: ["network", "country"],
    },
  }).query(
    (ctx) => `
SELECT
  fact_date,
  network,
  country,
  region,
  campaign_tag,
  COUNT(DISTINCT post_id)                                  AS posts,
  -- incremental sums (no double-counting)
  SUM(reach_delta)            AS reach_gained,
  SUM(views_delta)            AS views_gained,
  SUM(video_views_delta)      AS video_views_gained,
  SUM(comments_delta)         AS comments_gained,
  SUM(likes_delta)            AS likes_gained,
  SUM(shares_delta)           AS shares_gained,
  SUM(saves_delta)            AS saves_gained,
  SUM(engagement_delta)       AS engagement_gained,
  SUM(follows_delta)          AS follows_gained,
  SUM(profile_visits_delta)   AS profile_visits_gained,
  SUM(profile_activity_delta) AS profile_activity_gained,
  -- weighted engagement rate over the aggregated window
  SAFE_DIVIDE(SUM(engagement_delta), SUM(reach_delta)) AS engagement_rate,
  -- cadence-quality column: how many days did this period cover, on average?
  AVG(days_since_prev) AS avg_window_days
FROM ${ctx.ref({ schema: dtDataset, name: "post_metrics" })}
WHERE is_initial_snapshot = FALSE
GROUP BY fact_date, network, country, region, campaign_tag
`
  );
});
