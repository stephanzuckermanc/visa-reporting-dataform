// Data Mart (04X) — dm_format_performance: per network × format averages of cumulative metrics
// (post-level averages — "what does an average post of this format/network look like?").
// Source: 04X_dm.dm_post_performance (latest snapshot per post).
//
// engagement_rate is computed as a WEIGHTED ratio over the cohort, not as
// AVG(per-post rate). The previous version averaged rates which sesgaba a
// posts pequeños — fixed by recomputing from SUM(engagement) / SUM(reach).

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_format_performance", {
    schema: dmDataset,
    type: "table",
    description: `Format performance — ${region.toUpperCase()}. Cohort averages per network × format.`,
    bigquery: {
      clusterBy: ["network", "format"],
    },
  }).query(
    (ctx) => `
SELECT
  network,
  country,
  region,
  format,
  campaign_tag,
  COUNT(*) AS posts,
  -- weighted engagement rate over the cohort
  SAFE_DIVIDE(SUM(engagement), SUM(reach)) AS engagement_rate,
  -- per-post averages (state at latest snapshot)
  AVG(reach)       AS avg_reach,
  AVG(views)       AS avg_views,
  AVG(video_views) AS avg_video_views,
  AVG(likes)       AS avg_likes,
  -- cohort totals (cumulative, since these are latest snapshots — no double-count)
  SUM(reach)       AS total_reach,
  SUM(views)       AS total_views,
  SUM(engagement)  AS total_engagement
FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
GROUP BY network, country, region, format, campaign_tag
`
  );
});
