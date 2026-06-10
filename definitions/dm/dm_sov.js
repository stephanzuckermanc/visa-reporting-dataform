// Data Mart (04X) — dm_sov: Share of Voice en formato LARGO (date × scope × brand).
// Fuentes: sov_competidores_raw (6 marcas) y sov_sponsors_raw (9 marcas), ambas
// "anchas" (una columna por marca). Aquí se despivotean a largo para que el donut
// y las barras apiladas de Looker salgan naturales.
//
// scope distingue 'competitor' vs 'sponsor' (VISA aparece en ambos -> el scope
// los separa). mentions = conteo diario por marca. share_pct se RECALCULA como
// marca / total del scope ese día (no se usa el % pre-calculado del Sheet, que
// puede tener otra base). Para SOV de un rango, Looker debe sumar mentions por
// marca y normalizar (o usar share_pct con cuidado: es share diario).
//
// Grain: fecha × scope × brand_key (una fila por marca por día por scope).

const { datasetFor } = require("includes/country_to_region");

const dmDataset = datasetFor("dm", "latam"); // 042_visa_latam_dm

publish("dm_sov", {
  schema: dmDataset,
  type: "table",
  description:
    "Share of Voice largo (date × scope × brand) desde el Sheet VISA|Mentions. scope competitor/sponsor; mentions diarias por marca; share_pct = marca/total del scope por día.",
  bigquery: { partitionBy: "fecha", clusterBy: ["scope", "brand_key"] },
}).query(
  (ctx) => `
WITH comp AS (
  SELECT fecha, 'competitor' AS scope, brand_key, SAFE_CAST(mentions_str AS INT64) AS mentions
  FROM (
    SELECT fecha, nu, mastercard, visa, paypal, mercado_pago, amex
    FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "sov_competidores_raw" })}
  )
  UNPIVOT(mentions_str FOR brand_key IN (nu, mastercard, visa, paypal, mercado_pago, amex))
),
spon AS (
  SELECT fecha, 'sponsor' AS scope, brand_key, SAFE_CAST(mentions_str AS INT64) AS mentions
  FROM (
    SELECT fecha, lenovo, abinbev, unilever, mcdonalds, visa, adidas, coca_cola, kia, hyundai
    FROM ${ctx.ref({ schema: "002_visa_latam_dp", name: "sov_sponsors_raw" })}
  )
  UNPIVOT(mentions_str FOR brand_key IN (lenovo, abinbev, unilever, mcdonalds, visa, adidas, coca_cola, kia, hyundai))
),
u AS (
  SELECT * FROM comp
  UNION ALL
  SELECT * FROM spon
)
SELECT
  fecha,
  scope,
  brand_key,
  CASE brand_key
    WHEN 'nu' THEN 'Nu'                WHEN 'mastercard' THEN 'Mastercard'
    WHEN 'visa' THEN 'VISA'            WHEN 'paypal' THEN 'PayPal'
    WHEN 'mercado_pago' THEN 'Mercado Pago' WHEN 'amex' THEN 'Amex'
    WHEN 'lenovo' THEN 'Lenovo'        WHEN 'abinbev' THEN 'AB InBev'
    WHEN 'unilever' THEN 'Unilever'    WHEN 'mcdonalds' THEN "McDonald's"
    WHEN 'adidas' THEN 'Adidas'        WHEN 'coca_cola' THEN 'Coca-Cola'
    WHEN 'kia' THEN 'KIA'              WHEN 'hyundai' THEN 'Hyundai'
    ELSE brand_key
  END AS brand_label,
  mentions,
  SAFE_DIVIDE(mentions, SUM(mentions) OVER (PARTITION BY fecha, scope)) AS share_pct
FROM u
WHERE fecha IS NOT NULL
`
);
