// Data Mart (04X) — dm_executive_scorecard: 1 row per KPI for the "Executive
// Performance Scorecard" tile (Hoja 1 of the Looker dashboard).
//
// Joins computed actuals (from dm_post_performance) with hardcoded targets
// (from kpi_targets) and exposes:
//   - actual_value     : total over all data in dm_post_performance
//   - target_value     : from kpi_targets seed
//   - achievement_pct  : actual_value / target_value
//   - trend_pct        : (last30 - prev30) / prev30  — NULL if span < 60 days
//   - format_type      : 'number' | 'compact' | 'percent' (for Looker formatting)
//
// All numeric columns are FLOAT64 (raw). Pre-formatted strings should be
// created as calculated fields in Looker Studio (see LOOKER_BUILD_GUIDE.md).
//
// NOTE on trend: 'last30' = posts with published_date in last 30 days vs.
// 'prev30' = posts published in the 30 days before that. With <60 days of
// data trend is NULL. After the pilot accumulates 2+ months this column
// will start populating automatically.
//
// total_mentions and sov are placeholders (NULL) until the listening tool
// (Brandwatch / Talkwalker) is integrated — they still show in the table
// so the layout matches the mockup; the user sees the target with no actual.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_executive_scorecard", {
    schema: dmDataset,
    type: "table",
    description: `Executive scorecard — ${region.toUpperCase()}. 1 row per KPI, actual vs target plus trend.`,
  }).query(
    (ctx) => `
WITH bounds AS (
  SELECT
    MAX(published_date) AS max_date,
    MIN(published_date) AS min_date,
    DATE_SUB(MAX(published_date), INTERVAL 30 DAY) AS d_30,
    DATE_SUB(MAX(published_date), INTERVAL 60 DAY) AS d_60,
    DATE_DIFF(MAX(published_date), MIN(published_date), DAY) AS span_days
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
),
periods AS (
  SELECT
    CASE
      WHEN p.published_date > b.d_30                                                       THEN 'last'
      WHEN p.published_date > b.d_60 AND p.published_date <= b.d_30 AND b.span_days >= 60  THEN 'prev'
      ELSE NULL
    END AS period,
    p.*
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
  CROSS JOIN bounds b
),
agg_per_period AS (
  SELECT
    period,
    SAFE_DIVIDE(SUM(views), SUM(reach))           AS frequency,
    CAST(SUM(video_views)            AS FLOAT64)  AS views_2_3s,
    CAST(SUM(views)                  AS FLOAT64)  AS impressions,
    CAST(SUM(reach)                  AS FLOAT64)  AS reach,
    CAST(SUM(comments)               AS FLOAT64)  AS total_comments,
    AVG(vtr_50)                                   AS vtr,
    SAFE_DIVIDE(SUM(engagement), SUM(reach))      AS er,
    CAST(SUM(shares) + SUM(saves)    AS FLOAT64)  AS shares_saves,
    CAST(SUM(likes)                  AS FLOAT64)  AS total_likes,
    CAST(NULL                        AS FLOAT64)  AS total_mentions,
    CAST(NULL                        AS FLOAT64)  AS sov
  FROM periods
  WHERE period IS NOT NULL
  GROUP BY period
),
agg_all_time AS (
  SELECT
    CAST('all' AS STRING)                         AS period,
    SAFE_DIVIDE(SUM(views), SUM(reach))           AS frequency,
    CAST(SUM(video_views)            AS FLOAT64)  AS views_2_3s,
    CAST(SUM(views)                  AS FLOAT64)  AS impressions,
    CAST(SUM(reach)                  AS FLOAT64)  AS reach,
    CAST(SUM(comments)               AS FLOAT64)  AS total_comments,
    AVG(vtr_50)                                   AS vtr,
    SAFE_DIVIDE(SUM(engagement), SUM(reach))      AS er,
    CAST(SUM(shares) + SUM(saves)    AS FLOAT64)  AS shares_saves,
    CAST(SUM(likes)                  AS FLOAT64)  AS total_likes,
    CAST(NULL                        AS FLOAT64)  AS total_mentions,
    CAST(NULL                        AS FLOAT64)  AS sov
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
),
unioned AS (
  SELECT * FROM agg_per_period
  UNION ALL
  SELECT * FROM agg_all_time
),
unpivoted AS (
  SELECT period, metric_id, value
  FROM unioned
  UNPIVOT INCLUDE NULLS (
    value FOR metric_id IN (
      frequency, views_2_3s, impressions, reach, total_comments,
      vtr, er, shares_saves, total_likes, total_mentions, sov
    )
  )
),
pivoted AS (
  SELECT
    metric_id,
    MAX(IF(period = 'all',  value, NULL)) AS actual_all,
    MAX(IF(period = 'last', value, NULL)) AS actual_last30,
    MAX(IF(period = 'prev', value, NULL)) AS actual_prev30
  FROM unpivoted
  GROUP BY metric_id
)
SELECT
  t.metric_id,
  t.section,
  t.metric_label,
  t.display_order,
  p.actual_all                                                       AS actual_value,
  t.target_value,
  SAFE_DIVIDE(p.actual_all, t.target_value)                          AS achievement_pct,
  -- Pre-capped at 1.2 (120%) for the Looker bar chart.
  -- Using a BQ column avoids Looker SUM-aggregation bugs with calculated fields.
  LEAST(COALESCE(SAFE_DIVIDE(p.actual_all, t.target_value), 0), 1.2) AS achievement_bar,
  -- Cap trend at ±5 (500%) — values beyond that are backfill artifacts
  -- (prev30 period nearly empty vs last30 full of historical posts).
  -- Will normalize after a few weeks of daily incremental ingests.
  CASE
    WHEN ABS(SAFE_DIVIDE(p.actual_last30 - p.actual_prev30, p.actual_prev30)) > 5
      THEN NULL
    ELSE SAFE_DIVIDE(p.actual_last30 - p.actual_prev30, p.actual_prev30)
  END                                                                AS trend_pct,
  t.format_type
FROM ${ctx.ref({ schema: dmDataset, name: "kpi_targets" })} t
LEFT JOIN pivoted p USING (metric_id)
ORDER BY t.display_order
`
  );
});
