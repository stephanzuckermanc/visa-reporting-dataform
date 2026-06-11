// Data Mart (04X) — dm_match_content: posts del Google Sheet del CM ("Registro
// publicaciones", todo contenido Mundial FIFA 26) resueltos contra la base.
//
// El Sheet se materializa a la tabla nativa 002_visa_latam_dp.match_sheet_raw
// (vía scheduled query diaria — Dataform no puede leer Sheets directo). Cada
// fila trae un link de Instagram y/o uno de TikTok. Aquí extraemos la key de
// cada link y la matcheamos contra 042_visa_latam_dm.dm_post_performance para
// traer los KPIs reales del post.
//
// Matching (validado contra 042):
//   - IG reel/p/tv : shortcode del link  ->  source_link LIKE %shortcode%
//   - TikTok full  : video id del link   ->  post_id = video_id (en TikTok el
//                                            post_id ES el id del video)
//   - IG story (/s/) y TikTok short (/t/): NO matchean (limitación de origen).
//     Esos quedan reportados en dm_match_coverage, no acá.
//
// Salida = columnas de dm_post_performance (idéntico al "Post Metrics" de Looker)
// + dos dimensiones del Sheet pedidas por el usuario (2026-06-09):
//   tipo_contenido (Global/Jugadores/Creadores/Monks) y pauta (Orgánico/Pagado),
// para poder filtrar/segmentar en Looker. El `nombre` del Sheet sigue SIN
// proyectarse (solo se usa para matchear). Grain = post_id (un asset puede dar
// 2 posts: IG y TikTok).

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

publish("dm_match_content", {
  schema: dmDataset,
  type: "table",
  description:
    "Posts del Sheet CM (contenido Mundial FIFA 26) matcheados contra dm_post_performance. Mismas columnas que dm_post_performance, filtrado a los posts del Sheet. Grain = post_id.",
  bigquery: {
    partitionBy: "published_date",
    clusterBy: ["network"],
  },
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
-- pauta ahora viene partida por plataforma en el Sheet: el post de IG lleva
-- pauta_ig y el de TikTok pauta_tiktok, ambos proyectados a la MISMA columna de
-- salida pauta (Looker no cambia, pero el valor ya es correcto por red).
matched_ig AS (
  SELECT k.tipo_contenido, k.pauta_ig AS pauta, p.*
  FROM keys k
  JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
    ON k.ig_shortcode IS NOT NULL
   AND p.source_link LIKE CONCAT('%', k.ig_shortcode, '%')
),
matched_tk AS (
  SELECT k.tipo_contenido, k.pauta_tiktok AS pauta, p.*
  FROM keys k
  JOIN ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })} p
    ON k.tiktok_id IS NOT NULL
   AND p.post_id = k.tiktok_id
)
-- UNION DISTINCT colapsa cualquier post duplicado (si dos filas del Sheet
-- apuntan al mismo post, o si un shortcode matchea de más).
SELECT * FROM matched_ig
UNION DISTINCT
SELECT * FROM matched_tk
`
);
