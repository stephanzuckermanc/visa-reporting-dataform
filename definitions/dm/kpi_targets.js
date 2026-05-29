// Data Mart (04X) — kpi_targets: seed table with executive scorecard targets.
// 1 row per KPI. Edit `target_value` values in this file and re-deploy when
// the business sets new targets (typically quarterly).
//
// Format types:
//   - 'number'  → small decimals (Frequency)
//   - 'compact' → big counters (Reach, Views, Likes, ...) — show as 1.2M / 33K
//   - 'percent' → ratios stored as 0..1 (Engagement Rate, VTR, ...)
//
// Targets sourced from "KPIs & plan final data (1).pdf" / Visa_Mundial.pdf mockup.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("kpi_targets", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Executive scorecard KPI targets (seed) — ${region.toUpperCase()}. 1 row per KPI.`,
  }).query(
    () => `
SELECT 'frequency'      AS metric_id, 'Reach'      AS section, 'Frequency'             AS metric_label, 1  AS display_order, 2.8        AS target_value, 'number'  AS format_type
UNION ALL SELECT 'views_2_3s',        'Reach',      'Views (2-3s)',           2,  50600000.0, 'compact'
UNION ALL SELECT 'impressions',       'Reach',      'Impressions',            3,  75900000.0, 'compact'
UNION ALL SELECT 'reach',             'Reach',      'Accounts Reached',       4,  38000000.0, 'compact'
UNION ALL SELECT 'total_comments',    'Recall',     'Total Comments',         5,  38000.0,    'compact'
UNION ALL SELECT 'vtr',               'Recall',     'View Through Rate (%)',  6,  0.495,      'percent'
UNION ALL SELECT 'er',                'Engagement', 'Engagement Rate (%)',    7,  0.039,      'percent'
UNION ALL SELECT 'shares_saves',      'Engagement', 'Shares & Saves',         8,  1000000.0,  'compact'
UNION ALL SELECT 'total_likes',       'Engagement', 'Total Likes',            9,  3800000.0,  'compact'
UNION ALL SELECT 'total_mentions',    'Engagement', 'Total Mentions',         10, 126500.0,   'compact'
UNION ALL SELECT 'sov',               'Engagement', 'Share of Voice (%)',     11, 0.22,       'percent'
`
  );
});
