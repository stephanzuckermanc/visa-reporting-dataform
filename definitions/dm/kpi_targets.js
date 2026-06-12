// Data Mart (04X) — kpi_targets: targets del executive scorecard POR MARKET y POR
// PAUTA, derivados EN VIVO del sheet "VISA | Mundial | KPI" (vía kpi_targets_raw).
// Grain: 1 fila por (metric_id × market × pauta).
//   market ∈ {mexico, carcam, andino, total}
//   pauta  ∈ {organic, paid, total}  (de la col `kpi` del sheet: Organico/Pagado/TOTAL)
//
// Editás el sheet → la scheduled query refresca kpi_targets_raw → el próximo run
// de Dataform recalcula los targets. SIN re-deploy.
//
// Reshape:
//   - market mexico/carcam/andino = agregado de los países del sheet por su
//     columna `region`. Aditivos = SUMA; tasas/promedios (vtr, er, ave_*, *_rate)
//     = promedio simple. (El bloque TOTAL y Pagado ya vienen a nivel region.)
//   - market 'total' = la fila region=TOTAL del sheet tal cual.
//   ⚠️ PLACEHOLDER: el breakdown por país del sheet no reconcilia 100% con el TOTAL;
//      el 'total' es exacto (fila TOTAL del sheet), los markets son aproximados.
//   - Brandwatch (mentions, sov competidores/sponsors, positive sentiment) NO son
//     columnas del sheet: se definen en el bloque `manual` (solo pauta='total').
//   - UNPIVOT INCLUDE NULLS: las filas de Pagado hoy vienen vacías (target NULL),
//     pero IGUAL emitimos la fila (metric × market × paid, target=NULL) para que el
//     scorecard pueda matchear los ACTUALS de paid (sin target hasta que lo llenen).
//
// Formato: números con coma y '%' se limpian acá. tasas (vtr/er/*_rate) = valor/100.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("kpi_targets", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Executive scorecard KPI targets POR MARKET × PAUTA (live desde el sheet VISA|Mundial|KPI) — ${region.toUpperCase()}. Grain: metric_id × market × pauta.`,
  }).query(
    (ctx) => `
WITH clean AS (
  SELECT
    CASE UPPER(TRIM(region))
      WHEN 'MEXICO' THEN 'mexico'
      WHEN 'CARCAM' THEN 'carcam'
      WHEN 'ANDINO' THEN 'andino'
      WHEN 'TOTAL'  THEN 'total'
    END AS market,
    CASE UPPER(TRIM(kpi))
      WHEN 'ORGANICO' THEN 'organic'
      WHEN 'PAGADO'   THEN 'paid'
      WHEN 'TOTAL'    THEN 'total'
    END AS pauta,
    SAFE_CAST(REPLACE(reach, ',', '')           AS FLOAT64) AS reach,
    SAFE_CAST(REPLACE(views_platform, ',', '')  AS FLOAT64) AS views_platform,
    SAFE_CAST(REPLACE(impressions, ',', '')     AS FLOAT64) AS impressions,
    SAFE_CAST(REPLACE(ave_impressions, ',', '') AS FLOAT64) AS ave_impressions,
    SAFE_CAST(REPLACE(ave_views, ',', '')       AS FLOAT64) AS ave_views,
    SAFE_CAST(REPLACE(comments, ',', '')        AS FLOAT64) AS comments,
    SAFE_CAST(REPLACE(likes, ',', '')           AS FLOAT64) AS likes,
    SAFE_CAST(REPLACE(share, ',', '')           AS FLOAT64) AS share,
    SAFE_CAST(REPLACE(saves, ',', '')           AS FLOAT64) AS saves,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(vtr50, '%', ''), ',', '')           AS FLOAT64), 100) AS vtr,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(engagement_rate, '%', ''), ',', '') AS FLOAT64), 100) AS er,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(share_rate, '%', ''), ',', '')      AS FLOAT64), 100) AS share_rate,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(save_rate, '%', ''), ',', '')       AS FLOAT64), 100) AS save_rate
  FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "kpi_targets_raw" })}
  WHERE region IS NOT NULL AND TRIM(region) != '' AND kpi IS NOT NULL
),
markets AS (
  SELECT
    market, pauta,
    SUM(reach) AS reach, SUM(views_platform) AS views_platform, SUM(impressions) AS impressions,
    AVG(ave_impressions) AS ave_impressions, AVG(ave_views) AS ave_views,
    SUM(comments) AS comments, SUM(likes) AS likes, SUM(share) AS shares, SUM(saves) AS saves,
    AVG(vtr) AS vtr, AVG(er) AS er, AVG(share_rate) AS shares_rate, AVG(save_rate) AS saves_rate
  FROM clean
  WHERE market IN ('mexico', 'carcam', 'andino')
  GROUP BY market, pauta
),
total AS (
  SELECT
    'total' AS market, pauta,
    reach, views_platform, impressions, ave_impressions, ave_views,
    comments, likes, share AS shares, saves AS saves,
    vtr, er, share_rate AS shares_rate, save_rate AS saves_rate
  FROM clean
  WHERE market = 'total'
),
wide AS (
  SELECT * FROM markets
  UNION ALL
  SELECT * FROM total
),
long AS (
  SELECT market, pauta, metric_col, val
  FROM wide
  UNPIVOT INCLUDE NULLS (val FOR metric_col IN (
    reach, views_platform, impressions, ave_impressions, ave_views,
    comments, likes, shares, saves, vtr, er, shares_rate, saves_rate
  ))
),
-- Orden/secciones alineados al plan FIFA "Social Organic KPIs":
--   Reach: Reach(1) Views(2) Impressions(3) Ave.Impressions(4) Ave.Views(5)
--   Recall: VTR(6) Comments(7)
--   Engagement: SOV competidores(8) ER(9) Mentions(10) Likes(11)
--               Shares(12) SharesRate(13) Saves(14) SavesRate(15)
--               Positive Sentiment(16) SOV sponsors(17)
meta AS (
  SELECT * FROM UNNEST([
    STRUCT('reach'           AS metric_col, 'reach'           AS metric_id, 'Reach'      AS section, 'Accounts Reached'      AS metric_label, 1  AS display_order, 'compact' AS format_type),
    STRUCT('views_platform',  'views_2_3s',      'Reach',      'Views (2-3s)',          2,  'compact'),
    STRUCT('impressions',     'impressions',     'Reach',      'Impressions',           3,  'compact'),
    STRUCT('ave_impressions', 'ave_impressions', 'Reach',      'Ave. Impressions',      4,  'compact'),
    STRUCT('ave_views',       'ave_views',       'Reach',      'Ave. Views',            5,  'compact'),
    STRUCT('comments',        'total_comments',  'Recall',     'Total Comments',        7,  'compact'),
    STRUCT('vtr',             'vtr',             'Recall',     'View Through Rate (%)', 6,  'percent'),
    STRUCT('er',              'er',              'Engagement', 'Engagement Rate (%)',   9,  'percent'),
    STRUCT('shares',          'shares',          'Engagement', 'Shares',                12, 'compact'),
    STRUCT('shares_rate',     'shares_rate',     'Engagement', 'Shares Rate (%)',       13, 'percent'),
    STRUCT('saves',           'saves',           'Engagement', 'Saves',                 14, 'compact'),
    STRUCT('saves_rate',      'saves_rate',      'Engagement', 'Saves Rate (%)',        15, 'percent'),
    STRUCT('likes',           'total_likes',     'Engagement', 'Total Likes',           11, 'compact')
  ])
),
sheet_targets AS (
  SELECT m.metric_id, l.market, l.pauta, m.section, m.metric_label, m.display_order, l.val AS target_value, m.format_type
  FROM long l
  JOIN meta m USING (metric_col)
),
-- Brandwatch (no son columnas del sheet, ni se parten por pauta): Mentions, los 2
-- SOV y Positive Sentiment. Solo en market='total', pauta='total'.
manual AS (
  SELECT * FROM UNNEST([
    STRUCT('total_mentions'     AS metric_id, 'total' AS market, 'total' AS pauta, 'Engagement' AS section, 'Total Mentions'          AS metric_label, 10 AS display_order, 86938.0 AS target_value, 'compact' AS format_type),
    STRUCT('sov',                'total', 'total', 'Engagement', 'SOV vs Competidores (%)', 8,  0.041, 'percent'),
    STRUCT('positive_sentiment', 'total', 'total', 'Engagement', 'Positive Sentiment (%)',  16, 0.25,  'percent'),
    STRUCT('sov_sponsors',       'total', 'total', 'Engagement', 'SOV entre Sponsors (%)',  17, 0.034, 'percent')
  ])
)
SELECT * FROM sheet_targets
UNION ALL
SELECT * FROM manual
`
  );
});
