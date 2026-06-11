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
//   - total_mentions / sov = Brandwatch (no están en el sheet): NULL por market,
//     valor en 'total'.
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
    SUM(comments) AS comments, SUM(likes) AS likes, SUM(share) + SUM(saves) AS shares_saves,
    AVG(vtr) AS vtr, AVG(er) AS er
  FROM clean
  WHERE market IN ('mexico', 'carcam', 'andino')
  GROUP BY market
),
total AS (
  SELECT 'total' AS market, reach, views_platform, impressions, comments, likes,
         share + saves AS shares_saves, vtr, er
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
  UNPIVOT(val FOR metric_col IN (reach, views_platform, impressions, comments, likes, shares_saves, vtr, er))
),
meta AS (
  SELECT * FROM UNNEST([
    STRUCT('reach'          AS metric_col, 'reach'          AS metric_id, 'Reach'      AS section, 'Accounts Reached'      AS metric_label, 4  AS display_order, 'compact' AS format_type),
    STRUCT('views_platform', 'views_2_3s',     'Reach',      'Views (2-3s)',          2,  'compact'),
    STRUCT('impressions',    'impressions',    'Reach',      'Impressions',           3,  'compact'),
    STRUCT('comments',       'total_comments', 'Recall',     'Total Comments',        5,  'compact'),
    STRUCT('vtr',            'vtr',            'Recall',     'View Through Rate (%)', 6,  'percent'),
    STRUCT('er',             'er',             'Engagement', 'Engagement Rate (%)',   7,  'percent'),
    STRUCT('shares_saves',   'shares_saves',   'Engagement', 'Shares & Saves',        8,  'compact'),
    STRUCT('likes',          'total_likes',    'Engagement', 'Total Likes',           9,  'compact')
  ])
),
sheet_targets AS (
  SELECT m.metric_id, l.market, m.section, m.metric_label, m.display_order, l.val AS target_value, m.format_type
  FROM long l
  JOIN meta m USING (metric_col)
),
-- Brandwatch (no están en el sheet): total_mentions / sov.
brandwatch AS (
  SELECT * FROM UNNEST([
    STRUCT('total_mentions' AS metric_id, 'mexico' AS market, 'Engagement' AS section, 'Total Mentions' AS metric_label, 10 AS display_order, CAST(NULL AS FLOAT64) AS target_value, 'compact' AS format_type),
    STRUCT('total_mentions', 'carcam', 'Engagement', 'Total Mentions',     10, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('total_mentions', 'andino', 'Engagement', 'Total Mentions',     10, CAST(NULL AS FLOAT64), 'compact'),
    STRUCT('total_mentions', 'total',  'Engagement', 'Total Mentions',     10, 126500.0,              'compact'),
    STRUCT('sov',            'mexico', 'Engagement', 'Share of Voice (%)', 11, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('sov',            'carcam', 'Engagement', 'Share of Voice (%)', 11, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('sov',            'andino', 'Engagement', 'Share of Voice (%)', 11, CAST(NULL AS FLOAT64), 'percent'),
    STRUCT('sov',            'total',  'Engagement', 'Share of Voice (%)', 11, 0.22,                  'percent')
  ])
)
SELECT * FROM sheet_targets
UNION ALL
SELECT * FROM brandwatch
`
  );
});
