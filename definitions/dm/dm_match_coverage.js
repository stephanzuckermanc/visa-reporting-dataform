// Data Mart (04X) — dm_match_coverage: control de cobertura del Sheet CM.
//
// Una fila por (fila del Sheet × plataforma con link), con el estado de match
// y el motivo. Sirve para que el CM vea QUÉ links no se trackean y por qué
// (no se descarta nada en silencio). Es la contraparte de dm_match_content:
//   dm_match_content  = los que SÍ matchearon (con KPIs).
//   dm_match_coverage = TODOS los links del Sheet, matcheen o no, con motivo.
//
// reason:
//   ok               -> key extraída y matcheó un post en la base.
//   no_link          -> la celda de ese link está vacía.
//   ig_story         -> link de Instagram Story (/s/): no entra a la Analytics API.
//   tiktok_shortlink -> link corto de TikTok (/t/): no trae video id numérico.
//   not_yet_ingested -> key válida pero el post aún no está en la base (el
//                       scheduler 48h lo levanta luego), o no resolvió.
//   unparseable      -> hay link pero no se pudo extraer una key conocida.

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

// VISTA (no tabla): igual que dm_match_content, refleja el Sheet en vivo
// (match_sheet_raw cada 15 min) sin correr Dataform. Tabla chica.
publish("dm_match_coverage", {
  schema: dmDataset,
  type: "view",
  description:
    "Cobertura QA del Sheet CM: una fila por (fila del Sheet × plataforma con link) con match_status + reason. Contraparte de dm_match_content. VISTA: refleja el Sheet en vivo.",
}).query(
  (ctx) => `
WITH sheet_rows AS (
  -- row_id estable para poder deduplicar tras los LEFT JOIN sin colapsar
  -- filas de plantilla vacías entre sí.
  SELECT
    ROW_NUMBER() OVER () AS row_id,
    market, nombre AS content_name, fecha, link_ig, link_tiktok
  FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "match_sheet_raw" })}
),
unpivoted AS (
  SELECT
    row_id, market, content_name, fecha,
    'instagram' AS platform,
    link_ig     AS link,
    REGEXP_EXTRACT(link_ig, r'instagram\\.com/(?:reel|p|tv)/([^/?]+)') AS ig_shortcode,
    CAST(NULL AS STRING)                                               AS tiktok_id
  FROM sheet_rows
  UNION ALL
  SELECT
    row_id, market, content_name, fecha,
    'tiktok'     AS platform,
    link_tiktok  AS link,
    CAST(NULL AS STRING)                          AS ig_shortcode,
    REGEXP_EXTRACT(link_tiktok, r'/video/(\\d+)') AS tiktok_id
  FROM sheet_rows
),
-- LEFT JOIN (no subquery correlacionado: BigQuery soporta LIKE en el ON).
-- Cada JOIN está gateado por plataforma, así solo uno aplica por fila.
-- QUALIFY dedup por (row_id, platform) si un shortcode matchea varios posts.
resolved AS (
  SELECT
    u.row_id, u.market, u.content_name, u.fecha, u.platform, u.link,
    u.ig_shortcode, u.tiktok_id,
    COALESCE(ig.post_id, tk.post_id) AS matched_post_id
  FROM unpivoted u
  LEFT JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} ig
    ON u.platform = 'instagram'
   AND u.ig_shortcode IS NOT NULL
   AND ig.source_link LIKE CONCAT('%', u.ig_shortcode, '%')
  LEFT JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} tk
    ON u.platform = 'tiktok'
   AND u.tiktok_id IS NOT NULL
   AND tk.post_id = u.tiktok_id
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY u.row_id, u.platform
    ORDER BY COALESCE(ig.post_id, tk.post_id)
  ) = 1
)
SELECT
  market,
  content_name,
  fecha,
  platform,
  link,
  ig_shortcode,
  tiktok_id,
  matched_post_id,
  IF(matched_post_id IS NOT NULL, 'matched', 'unmatched') AS match_status,
  CASE
    WHEN link IS NULL OR TRIM(link) = '' THEN 'no_link'
    WHEN matched_post_id IS NOT NULL THEN 'ok'
    WHEN platform = 'instagram' AND REGEXP_CONTAINS(link, r'instagram\\.com/s/') THEN 'ig_story'
    WHEN platform = 'tiktok'    AND REGEXP_CONTAINS(link, r'tiktok\\.com/t/')    THEN 'tiktok_shortlink'
    WHEN platform = 'instagram' AND ig_shortcode IS NOT NULL THEN 'not_yet_ingested'
    WHEN platform = 'tiktok'    AND tiktok_id    IS NOT NULL THEN 'not_yet_ingested'
    ELSE 'unparseable'
  END AS reason
FROM resolved
`
);
