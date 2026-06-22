// Data Mart (04X) — dm_match_content: contenido Mundial FIFA 26 resuelto contra la base.
//
// DOS fuentes se unen acá:
//  A) OWNED (visamx): posts del Sheet CM "Registro publicaciones" (match_sheet_raw)
//     matcheados contra dm_post_performance por link (IG shortcode / TikTok video id).
//     Métricas = Hootsuite. Se les UNE `spend` desde Starcom (si el post tuvo pauta).
//  B) COLAB / influencer: filas del Sheet de Starcom (starcom_raw) que NO matchean
//     ningún post propio (solo viven en ese Sheet, no están en Hootsuite — ej. Edu
//     Sacal, El Mariana). Se traen con TODAS las métricas de Starcom (congeladas),
//     tipo_contenido='Colaboración', pauta='Pagado'.
//
// Decisión (2026-06-18): para los OWNED las métricas SIEMPRE son de Hootsuite; de
// Starcom solo se toma `spend`. Los COLAB traen todo de Starcom. El scorecard /
// timeseries / format EXCLUYEN tipo_contenido='Colaboración' (no suman a los KPIs
// propios todavía).
//
// Naming-trap del modelo: col `views` = IMPRESSIONS, col `video_views` = views(2-3s).
// Starcom Impressions -> views; Starcom views -> video_views.
//
// Salida = columnas de dm_post_performance + tipo_contenido + pauta + spend.
// VISTA: refleja match_sheet_raw (15 min) y starcom_raw (semanal) sin correr Dataform.

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

publish("dm_match_content", {
  schema: dmDataset,
  type: "view",
  description:
    "Contenido Mundial: OWNED (Sheet CM × dm_post_performance, métricas Hootsuite + spend de Starcom) + COLAB (starcom_raw sin match propio, métricas Starcom congeladas, tipo_contenido='Colaboración'). Grain = post. VISTA.",
}).query(
  (ctx) => `
WITH keys AS (
  SELECT
    tipo_contenido,
    pauta_ig,
    pauta_tiktok,
    REGEXP_EXTRACT(link_ig,     r'instagram\\.com/(?:reel|p|tv)/([^/?]+)') AS ig_shortcode,
    REGEXP_EXTRACT(link_tiktok, r'/video/(\\d+)')                          AS tiktok_id
  FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "match_sheet_raw" })}
),
-- Starcom parseado (contenido pagado + influencer). post_id viene del Apps Script:
-- numérico = TikTok video id; si no = IG shortcode. El network del Sheet NO es
-- confiable, así que decidimos por el tipo de post_id.
starcom AS (
  SELECT
    post_id AS sc_key,
    REGEXP_CONTAINS(post_id, r'^[0-9]+$') AS es_tiktok,
    name, creador, format AS sc_format, url AS sc_url,
    SAFE_CAST(REPLACE(REPLACE(REPLACE(inversion_ejecutada, '$', ''), ',', ''), ' ', '') AS FLOAT64) AS spend,
    SAFE.PARSE_DATE('%B %d %Y', CONCAT(TRIM(published_date), ' 2026')) AS sc_date,
    SAFE_CAST(REPLACE(REPLACE(reach,       ' ', ''), ',', '') AS INT64) AS sc_reach,
    SAFE_CAST(REPLACE(REPLACE(impressions, ' ', ''), ',', '') AS INT64) AS sc_impr,
    SAFE_CAST(REPLACE(REPLACE(views,       ' ', ''), ',', '') AS INT64) AS sc_views,
    SAFE_CAST(REPLACE(REPLACE(likes,       ' ', ''), ',', '') AS INT64) AS sc_likes,
    SAFE_CAST(REPLACE(REPLACE(comments,    ' ', ''), ',', '') AS INT64) AS sc_comments,
    SAFE_CAST(REPLACE(REPLACE(shares,      ' ', ''), ',', '') AS INT64) AS sc_shares,
    SAFE_CAST(REPLACE(REPLACE(engagement,  ' ', ''), ',', '') AS INT64) AS sc_engagement,
    SAFE_DIVIDE(SAFE_CAST(REPLACE(REPLACE(vtr_50, '%', ''), ' ', '') AS FLOAT64), 100) AS sc_vtr
  FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "starcom_raw" })}
  WHERE url LIKE 'http%' AND post_id IS NOT NULL AND TRIM(post_id) != ''
),
spend_owned AS (
  -- spend + el reach de Starcom (el que la pauta compró) para CPM correcto.
  SELECT sc_key, es_tiktok, MAX(spend) AS spend, MAX(sc_reach) AS spend_reach
  FROM starcom GROUP BY sc_key, es_tiktok
),
-- keys de Starcom que SÍ matchean un post propio. INNER JOIN permite OR/LIKE en el
-- ON (el anti-join de NOT EXISTS NO permite LIKE en BigQuery). colab = los que NO
-- están acá (NOT IN).
owned_keys AS (
  SELECT DISTINCT s.sc_key
  FROM starcom s
  JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
    ON (s.es_tiktok     AND p.post_id = s.sc_key)
    OR (NOT s.es_tiktok AND p.source_link LIKE CONCAT('%', s.sc_key, '%'))
),
-- ---- A) OWNED: métricas Hootsuite + spend de Starcom ----
matched_ig AS (
  SELECT k.tipo_contenido, k.pauta_ig AS pauta, p.*, sp.spend, sp.spend_reach
  FROM keys k
  JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
    ON k.ig_shortcode IS NOT NULL
   AND p.source_link LIKE CONCAT('%', k.ig_shortcode, '%')
  LEFT JOIN spend_owned sp
    ON NOT sp.es_tiktok
   AND p.source_link LIKE CONCAT('%', sp.sc_key, '%')
),
matched_tk AS (
  SELECT k.tipo_contenido, k.pauta_tiktok AS pauta, p.*, sp.spend, sp.spend_reach
  FROM keys k
  JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
    ON k.tiktok_id IS NOT NULL
   AND p.post_id = k.tiktok_id
  LEFT JOIN spend_owned sp
    ON sp.es_tiktok
   AND p.post_id = sp.sc_key
),
owned AS (
  SELECT * FROM matched_ig
  UNION DISTINCT
  SELECT * FROM matched_tk
),
-- ---- B) COLAB: solo en Starcom (no matchea Hootsuite). Full Starcom, congelado.
-- 52 columnas en el ORDEN EXACTO de dm_post_performance (para que el UNION calce),
-- + tipo_contenido/pauta al principio y spend al final, igual que owned.
colab AS (
  SELECT
    'Colaboración' AS tipo_contenido,
    'Pagado'       AS pauta,
    s.sc_key                                   AS post_id,
    CAST(NULL AS STRING)                       AS profile_id,
    s.creador                                  AS username,
    IF(s.es_tiktok, 'TIKTOKBUSINESS', 'INSTAGRAMBUSINESS') AS network,
    CAST(NULL AS STRING)                       AS country,
    'latam'                                    AS region,
    'mexico'                                   AS market,
    CAST(NULL AS TIMESTAMP)                    AS published_at,
    s.sc_date                                  AS published_date,
    CAST(NULL AS DATE)                         AS fact_date,
    s.sc_format                                AS format,
    CAST(NULL AS STRING)                       AS campaign_tag,
    s.sc_url                                   AS source_link,
    s.name                                     AS copy,
    CAST(NULL AS STRING)                       AS thumbnail_url,
    s.sc_reach                                 AS reach,
    s.sc_impr                                  AS views,
    s.sc_views                                 AS video_views,
    s.sc_comments                              AS comments,
    s.sc_likes                                 AS likes,
    s.sc_shares                                AS shares,
    CAST(NULL AS INT64)                        AS saves,
    s.sc_engagement                            AS engagement,
    CAST(NULL AS INT64)                        AS follows,
    CAST(NULL AS INT64)                        AS profile_visits,
    CAST(NULL AS INT64)                        AS profile_activity,
    CAST(NULL AS INT64)                        AS exits,
    CAST(NULL AS INT64)                        AS taps_back,
    CAST(NULL AS INT64)                        AS taps_forward,
    CAST(NULL AS INT64)                        AS reach_delta,
    CAST(NULL AS INT64)                        AS views_delta,
    CAST(NULL AS INT64)                        AS video_views_delta,
    CAST(NULL AS INT64)                        AS comments_delta,
    CAST(NULL AS INT64)                        AS likes_delta,
    CAST(NULL AS INT64)                        AS shares_delta,
    CAST(NULL AS INT64)                        AS saves_delta,
    CAST(NULL AS INT64)                        AS engagement_delta,
    CAST(NULL AS INT64)                        AS follows_delta,
    CAST(NULL AS INT64)                        AS profile_visits_delta,
    CAST(NULL AS INT64)                        AS profile_activity_delta,
    CAST(NULL AS INT64)                        AS days_since_prev,
    SAFE_DIVIDE(s.sc_engagement, s.sc_reach)   AS engagement_rate,
    CAST(NULL AS FLOAT64)                      AS roi,
    SAFE_DIVIDE(s.sc_impr, s.sc_reach)         AS frequency,
    SAFE_DIVIDE(s.sc_shares, s.sc_reach)       AS share_rate,
    CAST(NULL AS FLOAT64)                      AS save_rate,
    CAST(NULL AS FLOAT64)                      AS ig_reels_avg_watch_time,
    CAST(NULL AS FLOAT64)                      AS ig_reels_video_view_total_time,
    CAST(NULL AS FLOAT64)                      AS average_time_watched,
    CAST(NULL AS FLOAT64)                      AS total_time_watched,
    CAST(NULL AS FLOAT64)                      AS full_video_watched_rate,
    s.sc_vtr                                   AS vtr_50,
    s.spend,
    s.sc_reach                                 AS spend_reach
  FROM starcom s
  WHERE s.sc_key NOT IN (SELECT sc_key FROM owned_keys)
)
-- network reformateado a nombre de red bien escrito (no MAYÚSCULAS) en la salida.
-- Cubre las redes actuales + fallback INITCAP para cualquier red futura.
SELECT * REPLACE (
  CASE network
    WHEN 'INSTAGRAMBUSINESS' THEN 'Instagram'
    WHEN 'TIKTOKBUSINESS'    THEN 'TikTok'
    WHEN 'YOUTUBECHANNEL'    THEN 'YouTube'
    WHEN 'FACEBOOKPAGE'      THEN 'Facebook'
    WHEN 'TWITTER'           THEN 'X'
    WHEN 'TWITTERV2'         THEN 'X'
    WHEN 'LINKEDIN'          THEN 'LinkedIn'
    WHEN 'LINKEDINCOMPANY'   THEN 'LinkedIn'
    ELSE INITCAP(network)
  END AS network
)
FROM (
  SELECT * FROM owned
  UNION ALL
  SELECT * FROM colab
)
`
);
