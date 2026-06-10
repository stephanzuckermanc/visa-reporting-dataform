// Data Mart (04X) — dm_platform_summary: aggregates per fact_date × network × country × campaign.
// Source: 02X_dt.post_metrics.
//
// SEMANTIC RULE for `*_gained` columns:
//   * For NON-initial snapshots: use the LAG-based delta (incremental gain
//     since the previous snapshot of the same post). Pure incremental.
//   * For INITIAL snapshots: use the cumulative value AS-IS. The first time
//     we see a post, its entire current state IS what it "gained" since
//     creation -- there's no prior measurement to subtract.
//
// Why include initials: on the first ingest of a 365d backfill, EVERY post
// is initial -> if we filtered them out, the time series in the dashboard
// would be empty. Once incremental daily runs accumulate, future snapshots
// produce real deltas and initials become rare.
//
// Cadence-agnostic: works whether the ingest runs daily, weekly, or sporadic.
// Use `avg_window_days` to detect cadence drift in QA.

const { REGIONS, datasetFor, marketSQL } = require("includes/country_to_region");

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
  ${marketSQL("country", "username")} AS market,
  campaign_tag,
  COUNT(DISTINCT post_id)                                                AS posts,
  -- COALESCE(delta, cumulative) so initial snapshots count their full state.
  SUM(COALESCE(reach_delta,            reach))            AS reach_gained,
  SUM(COALESCE(views_delta,            views))            AS views_gained,
  SUM(COALESCE(video_views_delta,      video_views))      AS video_views_gained,
  SUM(COALESCE(comments_delta,         comments))         AS comments_gained,
  SUM(COALESCE(likes_delta,            likes))            AS likes_gained,
  SUM(COALESCE(shares_delta,           shares))           AS shares_gained,
  SUM(COALESCE(saves_delta,            saves))            AS saves_gained,
  SUM(COALESCE(engagement_delta,       engagement))       AS engagement_gained,
  SUM(COALESCE(follows_delta,          follows))          AS follows_gained,
  SUM(COALESCE(profile_visits_delta,   profile_visits))   AS profile_visits_gained,
  SUM(COALESCE(profile_activity_delta, profile_activity)) AS profile_activity_gained,
  -- weighted engagement rate over the aggregated window
  SAFE_DIVIDE(
    SUM(COALESCE(engagement_delta, engagement)),
    SUM(COALESCE(reach_delta,      reach))
  ) AS engagement_rate,
  -- cadence-quality column: how many days did this period cover, on average?
  AVG(days_since_prev) AS avg_window_days
FROM ${ctx.ref({ schema: dtDataset, name: "post_metrics" })}
GROUP BY fact_date, network, country, region, market, campaign_tag
`
  );
});
