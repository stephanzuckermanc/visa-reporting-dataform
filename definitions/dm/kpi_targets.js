// Data Mart (04X) — kpi_targets: seed table with executive scorecard targets.
// 1 row per KPI. Edit `target_value` values in this file and re-deploy when
// the business sets new targets (typically quarterly).
//
// Format types:
//   - 'number'  → small decimals (none currently)
//   - 'compact' → big counters (Reach, Views, Likes, ...) — show as 1.2M / 33K
//   - 'percent' → ratios stored as 0..1 (Engagement Rate, VTR, ...)
//
// Targets actualizados 2026-06-08 con los del scorecard ejecutivo del Mundial
// (fuente Hootsuite). Los KPIs de fuente Brandwatch (total_mentions, sov) se
// dejan con su valor previo: se actualizan cuando se integre Brandwatch.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("kpi_targets", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Executive scorecard KPI targets (seed) — ${region.toUpperCase()}. 1 row per KPI.`,
  }).query(
    () => `
SELECT 'views_2_3s'     AS metric_id, 'Reach'      AS section, 'Views (2-3s)'          AS metric_label, 2  AS display_order, 129121.0   AS target_value, 'compact' AS format_type
UNION ALL SELECT 'impressions',       'Reach',      'Impressions',            3,  129121.0,   'compact'
UNION ALL SELECT 'reach',             'Reach',      'Accounts Reached',       4,  96407.0,    'compact'
UNION ALL SELECT 'total_comments',    'Recall',     'Total Comments',         5,  397.0,      'compact'
UNION ALL SELECT 'vtr',               'Recall',     'View Through Rate (%)',  6,  0.0532,     'percent'
UNION ALL SELECT 'er',                'Engagement', 'Engagement Rate (%)',    7,  0.0245,     'percent'
UNION ALL SELECT 'shares_saves',      'Engagement', 'Shares & Saves',         8,  184.0,      'compact'
UNION ALL SELECT 'total_likes',       'Engagement', 'Total Likes',            9,  1479.0,     'compact'
UNION ALL SELECT 'total_mentions',    'Engagement', 'Total Mentions',         10, 126500.0,   'compact'
UNION ALL SELECT 'sov',               'Engagement', 'Share of Voice (%)',     11, 0.22,       'percent'
`
  );
});
