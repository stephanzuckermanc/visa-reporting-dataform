// Data Mart (04X) — kpi_targets: targets del executive scorecard POR MARKET,
// derivados EN VIVO del sheet "VISA | Mundial | KPI" (vía kpi_targets_raw).
// Grain: 1 fila por (metric_id × market). market ∈ {mexico, carcam, andino, total}.
//
// Editás el sheet → la scheduled query refresca kpi_targets_raw → el próximo run
// de Dataform recalcula los targets. SIN re-deploy.
//
// Reshape:
//   - market mexico/carcam/andino = agregado de los países del sheet por su
//     columna `region`. Aditivos = SUMA; tasas (vtr, er) = promedio simple.
//   - market 'total' = la fila TOTAL del sheet tal cual.
//   ⚠️ PLACEHOLDER: el breakdown por país del sheet no reconcilia con el TOTAL
//      en Likes/Share/Saves (data dummy por país). Se refleja lo que el sheet diga.
//   - Brandwatch (mentions, sov competidores/sponsors, positive sentiment) y los
//     promedios/rates (ave_impressions/ave_views/shares_rate/saves_rate) NO son
//     columnas del sheet: se definen en el bloque `manual` (target del plan FIFA).
//
// Formato: números con coma y '%' se limpian acá. vtr/er = valor del sheet / 100.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("kpi_targets", {
    schema: datasetFor("dm", region),
    type: "table",
    description: `Executive scorecard KPI targets POR MARKET (live desde el sheet VISA|Mundial|KPI) — ${region.toUpperCase()}. Grain: metric_id × market.`,
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
    SAFE_CAST(REPLACE(reach, ',', '')          AS FLOAT64) AS reach,
    SAFE_CAST(REPLACE(views_platform, ',', '') AS FLOAT64) AS views_platform,
    SAFE_CAST(REPLACE(impressions, ',', '')    AS FLOAT64) AS impressions,
    SAFE_CAST(REPLACE(comments, ',', '')       AS FLOAT64) AS comments,
    SAFE_CAST(REPLACE(likes, ',', '')          AS FLOAT64) AS likes,
    SAFE_CAST(REPLACE(share, ',', '')          AS FLOAT64) AS share,
    SAFE_CAST(REPLACE(saves, ',', '')          AS FLOAT64) AS saves,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(vtr50, '%', ''), ',', '')          AS FLOAT64), 100) AS vtr,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(engagement_rate, '%', ''), ',', '') AS FLOAT64), 100) AS er
  FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "kpi_targets_raw" })}
  WHERE region IS NOT NULL AND TRIM(region) != ''
),
markets AS (
  SELECT
    market,
    SUM(reach) AS reach, SUM(views_platform) AS views_platform, SUM(impressions) AS impressions,
    SUM(comments) AS comments, SUM(likes) AS likes, SUM(share) AS shares, SUM(saves) AS saves,
    AVG(vtr) AS vtr, AVG(er) AS er
  FROM clean
  WHERE market IN ('mexico', 'carcam', 'andino')
  GROUP BY market
),
total AS (
  SELECT 'total' AS market, reach, views_platform, impressions, comments, likes,
         share AS shares, saves AS saves, vtr, er
  FROM clean
  WHERE market = 'total'
),
wide AS (
  SELECT * FROM markets
  UNION ALL
  SELECT * FROM total
),
long AS (
  SELECT market, metric_col, val
  FROM wide
  UNPIVOT(val FOR metric_col IN (reach, views_platform, impressions, comments, likes, shares, saves, vtr, er))
),
-- Orden/secciones alineados al plan FIFA "Social Organic KPIs":
--   Reach: Reach(1) Views(2) Impressions(3) Ave.Impressions(4) Ave.Views(5)
--   Recall: VTR(6) Comments(7)
--   Engagement: SOV competidores(8) ER(9) Mentions(10) Likes(11)
--               Shares(12) SharesRate(13) Saves(14) SavesRate(15)
--               Positive Sentiment(16) SOV sponsors(17)
meta AS (
  SELECT * FROM UNNEST([
    STRUCT('reach'          AS metric_col, 'reach'          AS metric_id, 'Reach'      AS section, 'Accounts Reached'      AS metric_label, 1  AS display_order, 'compact' AS format_type),
    STRUCT('views_platform', 'views_2_3s',     'Reach',      'Views (2-3s)',          2,  'compact'),
    STRUCT('impressions',    'impressions',    'Reach',      'Impressions',           3,  'compact'),
    STRUCT('comments',       'total_comments', 'Recall',     'Total Comments',        7,  'compact'),
    STRUCT('vtr',            'vtr',            'Recall',     'View Through Rate (%)', 6,  'percent'),
    STRUCT('er',             'er',             'Engagement', 'Engagement Rate (%)',   9,  'percent'),
    STRUCT('shares',         'shares',         'Engagement', 'Shares',                12, 'compact'),
    STRUCT('saves',          'saves',          'Engagement', 'Saves',                 14, 'compact'),
    STRUCT('likes',          'total_likes',    'Engagement', 'Total Likes',           11, 'compact')
  ])
),
sheet_targets AS (
  SELECT m.metric_id, l.market, m.section, m.metric_label, m.display_order, l.val AS target_value, m.format_type
  FROM long l
  JOIN meta m USING (metric_col)
),
-- Targets que NO vienen como columna del sheet: promedios y rates (Hootsuite,
-- con actual por market pero target solo total del plan) + Brandwatch (solo total).
-- Para las de Hootsuite emito las 3 filas de market con target NULL (para que la
-- métrica siga visible al filtrar por mercado) + la fila total con el valor del plan.
-- Las de Brandwatch solo existen en 'total' (no se parten por mercado).
manual AS (
  SELECT * FROM UNNEST([
    -- Reach (diagnóstico): promedios por post. target total del plan = 1,484.
    STRUCT('ave_impressions' AS metric_id, 'mexico' AS market, 'Reach' AS section, 'Ave. Impressions' AS metric_label, 4 AS display_order, CAST(NULL AS FLOAT64) AS target_value, 'compact' AS format_type),
    STRUCT('ave_impressions', 'carcam', 'Reach', 'Ave. Impressions', 4, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('ave_impressions', 'andino', 'Reach', 'Ave. Impressions', 4, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('ave_impressions', 'total',  'Reach', 'Ave. Impressions', 4, 1484.0,                'compact'),
    STRUCT('ave_views',       'mexico', 'Reach', 'Ave. Views',       5, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('ave_views',       'carcam', 'Reach', 'Ave. Views',       5, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('ave_views',       'andino', 'Reach', 'Ave. Views',       5, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('ave_views',       'total',  'Reach', 'Ave. Views',       5, 1484.0,                'compact'),
    -- Engagement: rates (denominador = reach). target total del plan.
    STRUCT('shares_rate', 'mexico', 'Engagement', 'Shares Rate (%)', 13, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('shares_rate', 'carcam', 'Engagement', 'Shares Rate (%)', 13, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('shares_rate', 'andino', 'Engagement', 'Shares Rate (%)', 13, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('shares_rate', 'total',  'Engagement', 'Shares Rate (%)', 13, 0.0087,                'percent'),
    STRUCT('saves_rate',  'mexico', 'Engagement', 'Saves Rate (%)',  15, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('saves_rate',  'carcam', 'Engagement', 'Saves Rate (%)',  15, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('saves_rate',  'andino', 'Engagement', 'Saves Rate (%)',  15, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('saves_rate',  'total',  'Engagement', 'Saves Rate (%)',  15, 0.0064,                'percent'),
    -- Brandwatch (solo total): Mentions, los 2 SOV y Positive Sentiment.
    STRUCT('total_mentions',     'total', 'Engagement', 'Total Mentions',          10, 86938.0, 'compact'),
    STRUCT('sov',                'total', 'Engagement', 'SOV vs Competidores (%)', 8,  0.041,   'percent'),
    STRUCT('positive_sentiment', 'total', 'Engagement', 'Positive Sentiment (%)',  16, 0.25,    'percent'),
    STRUCT('sov_sponsors',       'total', 'Engagement', 'SOV entre Sponsors (%)',  17, 0.034,   'percent')
  ])
)
SELECT * FROM sheet_targets
UNION ALL
SELECT * FROM manual
`
  );
});
