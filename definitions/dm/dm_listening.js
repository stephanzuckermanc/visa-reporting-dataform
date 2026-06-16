// Data Mart (04X) — dm_listening: métricas diarias de Social Listening (Brandwatch).
// Fuente: 002_visa_latam_dp.listening_raw (snapshot del Sheet "VISA | Mentions",
// tab "Listening"). Grain: fecha (una fila por día).
//
// Castea los STRING crudos a número y EXPONE LOS CONTEOS (men_pos/neg/neu) para
// que Looker recompute los % sobre el rango de fechas filtrado (no se pre-divide:
// el % de un rango = SUM(positivas)/SUM(clasificadas), no el promedio de %s
// diarios). pct_* por fila quedan como referencia del día.
//
// Alimenta los tiles de la página Listening: Mentions (SUM total_mentions),
// Pot reach (SUM reach), + sentiment (SUM men_pos / SUM sentiment_total).

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

publish("dm_listening", {
  schema: dmDataset,
  type: "view",
  description:
    "Listening diario (Brandwatch) desde el Sheet VISA|Mentions. Grain: fecha. Conteos crudos + % por día; los % de rango se recomputan en Looker sobre los conteos. VISTA: refleja listening_raw al instante (scheduled query 11-14 MX) sin esperar el run de Dataform.",
}).query(
  (ctx) => `
SELECT
  fecha,
  SAFE_CAST(reach               AS INT64) AS reach,
  SAFE_CAST(total_mentions      AS INT64) AS total_mentions,
  SAFE_CAST(menciones_efectivas AS INT64) AS menciones_efectivas,
  SAFE_CAST(men_pos             AS INT64) AS men_pos,
  SAFE_CAST(men_neg             AS INT64) AS men_neg,
  SAFE_CAST(men_neu             AS INT64) AS men_neu,
  ( COALESCE(SAFE_CAST(men_pos AS INT64), 0)
  + COALESCE(SAFE_CAST(men_neg AS INT64), 0)
  + COALESCE(SAFE_CAST(men_neu AS INT64), 0) ) AS sentiment_total,
  -- % por día (referencia; para rangos, recomputar en Looker sobre los conteos)
  SAFE_DIVIDE(SAFE_CAST(men_pos AS INT64),
    SAFE_CAST(men_pos AS INT64) + SAFE_CAST(men_neg AS INT64) + SAFE_CAST(men_neu AS INT64)) AS pct_pos,
  SAFE_DIVIDE(SAFE_CAST(men_neg AS INT64),
    SAFE_CAST(men_pos AS INT64) + SAFE_CAST(men_neg AS INT64) + SAFE_CAST(men_neu AS INT64)) AS pct_neg,
  SAFE_DIVIDE(SAFE_CAST(men_neu AS INT64),
    SAFE_CAST(men_pos AS INT64) + SAFE_CAST(men_neg AS INT64) + SAFE_CAST(men_neu AS INT64)) AS pct_neu
FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "listening_raw" })}
WHERE fecha IS NOT NULL
`
);
