// Data Mart (04X) — dm_format_performance: averages per network × format.
// Source: 04X_dm.dm_post_performance (uses the dedup'd latest-snapshot view).
// Feeds "Organic Results per Content Format" section in the dashboard.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_format_performance", {
    schema: dmDataset,
    type: "table",
    description: `Format performance — ${region.toUpperCase()}. Averages per network × format.`,
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
  AVG(engagement_rate) AS avg_engagement_rate,
  AVG(reach)           AS avg_reach,
  AVG(views)           AS avg_views,
  AVG(video_views)     AS avg_video_views,
  AVG(likes)           AS avg_likes
FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
GROUP BY network, country, region, format, campaign_tag
`
  );
});
