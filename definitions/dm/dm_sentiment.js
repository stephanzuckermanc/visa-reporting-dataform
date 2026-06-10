// Data Mart (04X) — dm_sentiment: sentimiento del listening en formato LARGO
// (fecha × sentiment). Fuente: dm_listening (conteos men_pos/neg/neu por día).
//
// dm_listening expone los 3 conteos como COLUMNAS (bien para tiles/sumas), pero
// un donut/pie de Looker necesita el sentimiento como DIMENSIÓN (1 dim + 1 metric).
// Acá se despivotea a (fecha, sentiment, mentions) para que el donut "Sentiment"
// y las barras apiladas por semana salgan naturales. Mismo criterio que dm_sov.
//
// Grain: fecha × sentiment (3 filas por día: Positive/Neutral/Negative).

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

publish("dm_sentiment", {
  schema: dmDataset,
  type: "table",
  description:
    "Sentimiento listening largo (fecha × sentiment) desde dm_listening, para el donut/barras de Sentiment en Looker.",
  bigquery: { partitionBy: "fecha", clusterBy: ["sentiment"] },
}).query(
  (ctx) => `
SELECT
  fecha,
  CASE sentiment_key
    WHEN 'men_pos' THEN 'Positive'
    WHEN 'men_neu' THEN 'Neutral'
    WHEN 'men_neg' THEN 'Negative'
  END AS sentiment,
  mentions
FROM (
  SELECT fecha, men_pos, men_neg, men_neu
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_listening" })}
)
UNPIVOT(mentions FOR sentiment_key IN (men_pos, men_neu, men_neg))
WHERE fecha IS NOT NULL
`
);
