// Data Mart (04X) — dm_platform_summary_daily: daily aggregates per network × country × campaign.
// Source: 02X_dt.post_metrics (latest snapshot per post per ingest_date).
// Feeds Brand Performance Summary tiles in Looker.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dtDataset = datasetFor("dt", region);

  publish("dm_platform_summary_daily", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Daily aggregates per network/country/campaign — ${region.toUpperCase()}.`,
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
  COUNT(DISTINCT post_id) AS posts,
  SUM(reach)        AS total_reach,
  SUM(views)        AS total_views,
  SUM(video_views)  AS total_video_views,
  SUM(comments)    AS total_comments,
  SUM(likes)        AS total_likes,
  SUM(shares)       AS total_shares,
  SUM(saves)        AS total_saves,
  SUM(engagement)   AS total_engagement,
  AVG(engagement_rate) AS avg_engagement_rate
FROM ${ctx.ref({ schema: dtDataset, name: "post_metrics" })}
GROUP BY fact_date, network, country, region, campaign_tag
`
  );
});
