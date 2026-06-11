// Data Mart (04X) — dm_executive_scorecard: DATE-FILTERABLE executive scorecard.
//
// GRAIN: metric_id × published_date × network. Each row is the contribution of
// the posts PUBLISHED on that date, ON THAT NETWORK, to that KPI. The dashboard's
// Date control filters by `published_date` and the Network control by `network`;
// Looker then re-aggregates per the rules below. With NO network filter, summing
// over all networks reproduces the all-network totals exactly.
//
// NOTE on targets under a network filter: target_value comes from kpi_targets
// (one number per metric, NOT split by network), so it is constant across the
// network rows of a metric. Looker must aggregate Target as MAX(target_value)
// (never SUM). When you filter to e.g. FB+IG, the Actual shrinks to that subset
// but the Target stays the full all-network target -> achievement % is "subset
// actual vs total target". Split targets per network would need network-level
// rows in kpi_targets (not available today).
// (Previous version pre-aggregated all-time in BQ and could NOT respond to the
//  date filter. This rewrite moves the final aggregation into Looker so the
//  scorecard shows "accumulated totals of the posts born within the selected
//  range, vs the static KPI targets".)
//
// ADDITIVE vs RATIO — the key design decision:
//   Some KPIs are additive (reach, views, comments, likes, shares+saves): the
//   Actual = SUM over the filtered dates. Others are ratios (er=engagement/reach,
//   vtr=avg vtr_50): they must be RECOMPUTED over the filtered
//   cohort, never summed. A single Looker column can't do both, so we expose:
//       num       FLOAT64  -- numerator contribution of that date
//       den       FLOAT64  -- denominator contribution (0 for additive metrics)
//       is_ratio  INT64    -- 1 for ratio KPIs, 0 for additive
//   and in Looker the Actual is:
//       CASE WHEN MAX(is_ratio)=1 THEN SUM(num)/SUM(den) ELSE SUM(num) END
//   (see LOOKER_BUILD_GUIDE.md §1.1). With no date filter this reproduces the
//   old all-time numbers exactly (SUM over all dates = SUM over all posts).
//
// "Latest snapshot per post, no double counting": guaranteed upstream by
// dm_post_performance (ROW_NUMBER picks the latest ingest per post_id). We sum
// those latest snapshots, so a post counts once, attributed to its publish date.
//
// trend_pct: kept as a FIXED all-time reference (last 30d vs prev 30d BY
// published_date), broadcast onto every date row (use MAX(trend_pct) in Looker).
// It does NOT react to the Looker date filter — it is a stable period-over-period
// signal that only becomes meaningful after ~60 days of daily snapshots.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_executive_scorecard", {
    schema: dmDataset,
    type: "table",
    description: `Date-filterable executive scorecard — ${region.toUpperCase()}. Grain: metric_id × published_date × network × market. Actual = SUM(num) (additive) or SUM(num)/SUM(den) (ratio); filter by published_date / network / market in Looker.`,
    bigquery: {
      partitionBy: "published_date",
      clusterBy: ["metric_id", "network"],
    },
  }).query(
    (ctx) => `
WITH pp AS (
  SELECT *
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
  WHERE published_date IS NOT NULL
),
-- Per-publish-date sums of the latest snapshot of each post (FLOAT64 so the
-- UNION ALL below keeps one consistent num/den type).
-- GROUPING SETS emite dos niveles por (published_date, network):
--   1) por market real (mexico/carcam/andino/NULL=sin-market)
--   2) un rollup 'total' (todos los markets juntos, incluye sin-market)
-- Así el scorecard se compara contra el target por market O contra el total.
per_date AS (
  -- el subquery hace el GROUPING SETS crudo (market + flag is_rollup); el SELECT
  -- externo arma el label 'total' para las filas de rollup. (Hacerlo en un solo
  -- nivel choca: el alias market con IF(GROUPING(...)) colisiona en el GROUP BY.)
  SELECT
    published_date,
    network,
    IF(is_rollup = 1, 'total', market) AS market,
    s_views, s_reach, s_video_views, s_comments, s_likes, s_shares, s_saves, s_engagement, s_vtr, c_vtr, c_posts
  FROM (
    SELECT
      published_date,
      network,
      market,
      GROUPING(market) AS is_rollup,
      CAST(SUM(views)        AS FLOAT64) AS s_views,
      CAST(SUM(reach)        AS FLOAT64) AS s_reach,
      CAST(SUM(video_views)  AS FLOAT64) AS s_video_views,
      CAST(SUM(comments)     AS FLOAT64) AS s_comments,
      CAST(SUM(likes)        AS FLOAT64) AS s_likes,
      CAST(SUM(shares)       AS FLOAT64) AS s_shares,
      CAST(SUM(saves)        AS FLOAT64) AS s_saves,
      CAST(SUM(engagement)   AS FLOAT64) AS s_engagement,
      CAST(SUM(vtr_50)       AS FLOAT64) AS s_vtr,
      CAST(COUNTIF(vtr_50 IS NOT NULL) AS FLOAT64) AS c_vtr,
      CAST(COUNT(*)          AS FLOAT64) AS c_posts
    FROM pp
    GROUP BY GROUPING SETS (
      (published_date, network, market),
      (published_date, network)
    )
  )
),
-- One (published_date, network, market, metric_id, num, den) row per KPI. den = 0
-- for additive metrics (Looker never divides them); den = real denominator for ratios.
metrics_long AS (
  SELECT published_date, network, market, 'views_2_3s'  AS metric_id, s_video_views AS num, 0.0 AS den FROM per_date
  UNION ALL SELECT published_date, network, market, 'impressions',     s_views,             0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, 'reach',           s_reach,             0.0      FROM per_date
  -- promedios por post: Actual = SUM(num)/SUM(c_posts) -> son ratios (is_ratio=1).
  UNION ALL SELECT published_date, network, market, 'ave_impressions', s_views,             c_posts  FROM per_date
  UNION ALL SELECT published_date, network, market, 'ave_views',       s_video_views,       c_posts  FROM per_date
  UNION ALL SELECT published_date, network, market, 'total_comments',  s_comments,          0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, 'vtr',             s_vtr,               c_vtr    FROM per_date
  UNION ALL SELECT published_date, network, market, 'er',              s_engagement,        s_reach  FROM per_date
  -- shares/saves separados (absoluto) + sus rates (denominador = reach).
  UNION ALL SELECT published_date, network, market, 'shares',          s_shares,            0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, 'shares_rate',     s_shares,            s_reach  FROM per_date
  UNION ALL SELECT published_date, network, market, 'saves',           s_saves,             0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, 'saves_rate',      s_saves,             s_reach  FROM per_date
  UNION ALL SELECT published_date, network, market, 'total_likes',     s_likes,             0.0      FROM per_date
),
-- ---- Brandwatch al scorecard (grain = fecha, sin network/market) ----
-- Mentions, los 2 SOV y Positive Sentiment son métricas de MARCA: no se parten
-- por red ni mercado. Se emiten en market='total' y network=NULL, con
-- published_date = fecha para que el control de fecha de Looker las filtre. Al
-- filtrar por un mercado o red concretos, quedan en blanco (es correcto: no se
-- pueden atribuir a IG-solo ni a un país).
bw_daily AS (
  SELECT fecha, total_mentions, men_pos, sentiment_total
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_listening" })}
),
bw_sov AS (
  SELECT
    fecha,
    SUM(IF(scope = 'competitor' AND brand_key = 'visa', mentions, 0)) AS visa_comp,
    SUM(IF(scope = 'competitor',                         mentions, 0)) AS tot_comp,
    SUM(IF(scope = 'sponsor'    AND brand_key = 'visa', mentions, 0)) AS visa_spon,
    SUM(IF(scope = 'sponsor',                            mentions, 0)) AS tot_spon
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_sov" })}
  GROUP BY fecha
),
brandwatch_long AS (
  SELECT fecha AS published_date, CAST(NULL AS STRING) AS network, 'total' AS market,
         'total_mentions' AS metric_id, CAST(total_mentions AS FLOAT64) AS num, 0.0 AS den
  FROM bw_daily
  UNION ALL SELECT fecha, NULL, 'total', 'positive_sentiment', CAST(men_pos AS FLOAT64), CAST(sentiment_total AS FLOAT64) FROM bw_daily
  UNION ALL SELECT fecha, NULL, 'total', 'sov',          CAST(visa_comp AS FLOAT64), CAST(tot_comp AS FLOAT64) FROM bw_sov
  UNION ALL SELECT fecha, NULL, 'total', 'sov_sponsors', CAST(visa_spon AS FLOAT64), CAST(tot_spon AS FLOAT64) FROM bw_sov
),
metrics_all AS (
  SELECT published_date, network, market, metric_id, num, den FROM metrics_long
  UNION ALL
  SELECT published_date, network, market, metric_id, num, den FROM brandwatch_long
),
-- ---- Fixed all-time trend (last 30d vs prev 30d by published_date) ----
bounds AS (
  SELECT
    DATE_SUB(MAX(published_date), INTERVAL 30 DAY) AS d_30,
    DATE_SUB(MAX(published_date), INTERVAL 60 DAY) AS d_60,
    DATE_DIFF(MAX(published_date), MIN(published_date), DAY) AS span_days
  FROM pp
),
periods AS (
  SELECT
    CASE
      WHEN p.published_date > b.d_30                                                      THEN 'last'
      WHEN p.published_date > b.d_60 AND p.published_date <= b.d_30 AND b.span_days >= 60 THEN 'prev'
      ELSE NULL
    END AS period,
    p.*
  FROM pp p CROSS JOIN bounds b
),
trend_agg AS (
  SELECT
    period,
    network,
    market,
    CAST(SUM(video_views) AS FLOAT64)                     AS views_2_3s,
    CAST(SUM(views)       AS FLOAT64)                     AS impressions,
    CAST(SUM(reach)       AS FLOAT64)                     AS reach,
    CAST(SUM(comments)    AS FLOAT64)                     AS total_comments,
    SAFE_DIVIDE(SUM(vtr_50), COUNTIF(vtr_50 IS NOT NULL)) AS vtr,
    SAFE_DIVIDE(SUM(engagement), SUM(reach))              AS er,
    CAST(SUM(shares) + SUM(saves) AS FLOAT64)             AS shares_saves,
    CAST(SUM(likes)       AS FLOAT64)                     AS total_likes,
    CAST(NULL AS FLOAT64)                                 AS total_mentions,
    CAST(NULL AS FLOAT64)                                 AS sov
  FROM periods
  WHERE period IS NOT NULL
  GROUP BY period, network, market
),
trend_long AS (
  SELECT period, network, market, metric_id, value
  FROM trend_agg
  UNPIVOT INCLUDE NULLS (value FOR metric_id IN (
    views_2_3s, impressions, reach, total_comments,
    vtr, er, shares_saves, total_likes, total_mentions, sov
  ))
),
trend AS (
  SELECT
    metric_id,
    network,
    market,
    CASE
      WHEN ABS(SAFE_DIVIDE(
             MAX(IF(period='last', value, NULL)) - MAX(IF(period='prev', value, NULL)),
             MAX(IF(period='prev', value, NULL)))) > 5
        THEN NULL
      ELSE SAFE_DIVIDE(
             MAX(IF(period='last', value, NULL)) - MAX(IF(period='prev', value, NULL)),
             MAX(IF(period='prev', value, NULL)))
    END AS trend_pct
  FROM trend_long
  GROUP BY metric_id, network, market
)
SELECT
  m.published_date,
  m.network,
  m.market,
  t.metric_id,
  t.section,
  t.metric_label,
  t.display_order,
  t.format_type,
  CASE WHEN t.metric_id IN (
    'vtr', 'er', 'ave_impressions', 'ave_views',
    'shares_rate', 'saves_rate', 'sov', 'sov_sponsors', 'positive_sentiment'
  ) THEN 1 ELSE 0 END AS is_ratio,
  m.num,
  m.den,
  t.target_value,
  tr.trend_pct
FROM metrics_all m
JOIN ${ctx.ref({ schema: dmDataset, name: "kpi_targets" })} t USING (metric_id, market)
LEFT JOIN trend tr USING (metric_id, network, market)
`
  );
});
