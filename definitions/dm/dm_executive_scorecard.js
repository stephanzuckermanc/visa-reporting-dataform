// Data Mart (04X) — dm_executive_scorecard: DATE-FILTERABLE executive scorecard.
//
// FUENTE = dm_match_content (contenido Mundial FIFA 26 del Sheet del CM). Así el
// Actual del scorecard CUADRA con la tabla Monks Post Metrics (mismo set de posts
// curado). Todo el reporte es Mundial-only.
//
// GRAIN: metric_id × published_date × network × market × pauta. Cada fila es la
// contribución de los posts PUBLICADOS en esa fecha/red/mercado/pauta a ese KPI.
// Controles de Looker: Date (published_date), Network, Market, Paid/Organic (pauta).
//
// MARKET × PAUTA con GROUPING SETS: se emiten 4 niveles de rollup (market real o
// 'total' × pauta real o 'total'). Los controles Market y Pauta son SINGLE-SELECT
// con default 'total' -> eligen UNA celda del grid -> el Actual y el Target salen
// de una sola fila, sin doble conteo. (Sumar rollup + detalle daría ×2.)
//
// NOTE sobre targets bajo filtro de network: target_value viene de kpi_targets (un
// número por metric × market × pauta, NO partido por network), constante entre las
// filas de network de un metric. Looker agrega Target como MAX(target_value).
//
// ADDITIVE vs RATIO:
//   Aditivos (reach, views, comments, likes, shares, saves): Actual = SUM(num).
//   Ratios (er, vtr, ave_*, *_rate, sov, sentiment): Actual = SUM(num)/SUM(den),
//   recomputado sobre el cohorte filtrado, nunca sumado. Exponemos num/den/is_ratio
//   y en Looker: CASE WHEN MAX(is_ratio)=1 THEN SUM(num)/SUM(den) ELSE SUM(num) END.
//
// Brandwatch (mentions, 2×sov, positive sentiment): métricas de MARCA, no se parten
// por red/mercado/pauta -> se emiten en market='total', pauta='total', network=NULL.
//
// trend_pct: referencia fija (last 30d vs prev 30d por published_date), broadcast a
// cada fila (MAX(trend_pct) en Looker). No reacciona al filtro de fecha.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_executive_scorecard", {
    schema: dmDataset,
    type: "table",
    description: `Date-filterable executive scorecard (Mundial-only, desde dm_match_content) — ${region.toUpperCase()}. Grain: metric_id × published_date × network × market × pauta. Actual = SUM(num) (additive) o SUM(num)/SUM(den) (ratio); filtrar por published_date / network / market / pauta en Looker.`,
    bigquery: {
      partitionBy: "published_date",
      clusterBy: ["metric_id", "network", "market", "pauta"],
    },
  }).query(
    (ctx) => `
WITH pp AS (
  -- Fuente = dm_match_content (Mundial del Sheet). Normalizamos la pauta del Sheet
  -- (Orgánico/Pagado) a organic/paid; cualquier valor raro cae en 'organic'.
  SELECT * EXCEPT(pauta),
    CASE pauta WHEN 'Orgánico' THEN 'organic' WHEN 'Pagado' THEN 'paid' ELSE 'organic' END AS pauta
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_match_content" })}
  WHERE published_date IS NOT NULL
),
-- GROUPING SETS sobre (market × pauta) con 4 niveles: detalle, rollup de pauta,
-- rollup de market, y rollup total. IF(GROUPING(...)) arma los labels 'total'.
per_date AS (
  SELECT
    published_date,
    network,
    IF(is_rollup_m = 1, 'total', market) AS market,
    IF(is_rollup_p = 1, 'total', pauta)  AS pauta,
    s_views, s_reach, s_video_views, s_comments, s_likes, s_shares, s_saves, s_engagement, s_vtr, c_vtr, c_posts
  FROM (
    SELECT
      published_date,
      network,
      market,
      pauta,
      GROUPING(market) AS is_rollup_m,
      GROUPING(pauta)  AS is_rollup_p,
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
      (published_date, network, market, pauta),
      (published_date, network, market),
      (published_date, network, pauta),
      (published_date, network)
    )
  )
),
-- Una fila (published_date, network, market, pauta, metric_id, num, den) por KPI.
metrics_long AS (
  SELECT published_date, network, market, pauta, 'views_2_3s'  AS metric_id, s_video_views AS num, 0.0 AS den FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'impressions',     s_views,             0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'reach',           s_reach,             0.0      FROM per_date
  -- promedios por post: Actual = SUM(num)/SUM(c_posts) -> son ratios (is_ratio=1).
  UNION ALL SELECT published_date, network, market, pauta, 'ave_impressions', s_views,             c_posts  FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'ave_views',       s_video_views,       c_posts  FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'total_comments',  s_comments,          0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'vtr',             s_vtr,               c_vtr    FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'er',              s_engagement,        s_reach  FROM per_date
  -- shares/saves separados (absoluto) + sus rates (denominador = reach).
  UNION ALL SELECT published_date, network, market, pauta, 'shares',          s_shares,            0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'shares_rate',     s_shares,            s_reach  FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'saves',           s_saves,             0.0      FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'saves_rate',      s_saves,             s_reach  FROM per_date
  UNION ALL SELECT published_date, network, market, pauta, 'total_likes',     s_likes,             0.0      FROM per_date
),
-- ---- Brandwatch al scorecard (grain = fecha, sin network/market/pauta) ----
-- Mentions, los 2 SOV y Positive Sentiment son métricas de MARCA. Se emiten en
-- market='total', pauta='total', network=NULL. Al filtrar por un mercado/red/pauta
-- concretos quedan en blanco (correcto: no se atribuyen a IG-solo ni a paid).
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
  SELECT fecha AS published_date, CAST(NULL AS STRING) AS network, 'total' AS market, 'total' AS pauta,
         'total_mentions' AS metric_id, CAST(total_mentions AS FLOAT64) AS num, 0.0 AS den
  FROM bw_daily
  UNION ALL SELECT fecha, NULL, 'total', 'total', 'positive_sentiment', CAST(men_pos AS FLOAT64), CAST(sentiment_total AS FLOAT64) FROM bw_daily
  UNION ALL SELECT fecha, NULL, 'total', 'total', 'sov',          CAST(visa_comp AS FLOAT64), CAST(tot_comp AS FLOAT64) FROM bw_sov
  UNION ALL SELECT fecha, NULL, 'total', 'total', 'sov_sponsors', CAST(visa_spon AS FLOAT64), CAST(tot_spon AS FLOAT64) FROM bw_sov
),
metrics_all AS (
  SELECT published_date, network, market, pauta, metric_id, num, den FROM metrics_long
  UNION ALL
  SELECT published_date, network, market, pauta, metric_id, num, den FROM brandwatch_long
),
-- ---- Fixed all-time trend (last 30d vs prev 30d by published_date) ----
-- A nivel (metric, network, market); no se parte por pauta (referencia gruesa).
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
  m.pauta,
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
JOIN ${ctx.ref({ schema: dmDataset, name: "kpi_targets" })} t USING (metric_id, market, pauta)
LEFT JOIN trend tr USING (metric_id, network, market)
`
  );
});
