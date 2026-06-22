// Data Mart (04X) — dm_content_timeseries: daily content-calendar time series.
// Source: 04X_dm.dm_post_performance (latest snapshot per post).
//
// WHY THIS TABLE EXISTS (fixes GAP P0 in DATA_INTEGRITY_DIAGNOSTICS.md):
//   dm_platform_summary aggregates by `fact_date` = `ingest_date` (when the
//   ETL ran). With only a handful of ingest runs, the dashboard time series
//   collapse to a few points and the 365d backfill piles onto a single day
//   (a huge fake spike). That is an "ingest activity" view, NOT a content
//   performance view.
//
//   This table instead plots by `published_date` (the content calendar) and
//   sums the LATEST cumulative metric of every post published that day, i.e.
//   "how did the content we published on day X perform?". That is the correct
//   X axis for every "... over time" chart in the dashboard.
//
// DATE SPINE: we GENERATE_DATE_ARRAY(min_pub, max_pub) × the (network, region)
//   pairs that actually appear in the data, then LEFT JOIN the aggregates.
//   Counter metrics are COALESCEd to 0 on days with no posts so volume lines
//   are CONTINUOUS (no gaps). Rate metrics (engagement_rate, frequency) stay
//   NULL on empty days — a 0% rate on a no-post day would be a lie and would
//   drag down any AVG. Rate charts may therefore still gap on no-post days;
//   use weekly granularity for those if needed.
//
// GRAIN: published_date × network × region. Country is intentionally NOT in
//   the grain (a spine over date × network × country would be ~95% empty rows
//   and many networks never exist in many countries). For a per-country
//   breakdown over time, use dm_post_performance grouped by published_date,
//   or dm_platform_summary. The dashboard's Platform (network) control DOES
//   work on this table; the Country control will not sub-segment these lines.
//
// COEXISTS WITH dm_platform_summary — does not replace it. platform_summary
//   remains the "real incremental deltas by ingest date" view, useful once the
//   daily scheduler accumulates enough snapshots.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);

  publish("dm_content_timeseries", {
    schema: dmDataset,
    type: "table",
    description: `Daily content-calendar time series by published_date (Mundial-only, desde dm_match_content; date-spine filled) — ${region.toUpperCase()}. Source for all "... over time" charts. Grain incl. pauta (organic/paid).`,
    bigquery: {
      partitionBy: "published_date",
      clusterBy: ["network", "market", "pauta"],
    },
  }).query(
    (ctx) => `
WITH agg AS (
  -- Fuente = dm_match_content (Mundial). pauta del Sheet normalizada a organic/paid.
  SELECT
    published_date,
    network,
    region,
    COALESCE(market, 'sin_market') AS market,  -- evita NULLs en la key del JOIN del spine
    CASE pauta WHEN 'Orgánico' THEN 'organic' WHEN 'Pagado' THEN 'paid' ELSE 'organic' END AS pauta,
    COUNT(DISTINCT post_id)  AS posts,
    SUM(reach)               AS reach,
    SUM(views)               AS views,
    SUM(video_views)         AS video_views,
    SUM(comments)            AS comments,
    SUM(likes)               AS likes,
    SUM(shares)              AS shares,
    SUM(saves)               AS saves,
    SUM(engagement)          AS engagement
  FROM ${ctx.ref({ schema: dmDataset, name: "dm_match_content" })}
  WHERE published_date IS NOT NULL
    AND COALESCE(tipo_contenido, '') != 'Colaboración'  -- colab/influencer NO suma a KPIs
  GROUP BY published_date, network, region, COALESCE(market, 'sin_market'),
           CASE pauta WHEN 'Orgánico' THEN 'organic' WHEN 'Pagado' THEN 'paid' ELSE 'organic' END
),
bounds AS (
  SELECT MIN(published_date) AS min_d, MAX(published_date) AS max_d FROM agg
),
-- (network, region, market) combos que existen -> el spine no inventa
-- combinaciones imposibles (market es de baja cardinalidad: mexico/carcam/andino/NULL).
dims AS (
  SELECT DISTINCT network, region, market, pauta FROM agg
),
-- date spine × dims so every day has a row per combo ->
-- continuous lines even on days that combo published nothing.
spine AS (
  SELECT day AS published_date, dims.network, dims.region, dims.market, dims.pauta
  FROM bounds,
       UNNEST(GENERATE_DATE_ARRAY(bounds.min_d, bounds.max_d)) AS day
  CROSS JOIN dims
)
SELECT
  s.published_date,
  s.network,
  s.region,
  s.market,
  s.pauta,
  -- volume counters: 0-filled on empty days (continuous lines)
  COALESCE(a.posts,        0) AS posts,
  COALESCE(a.reach,        0) AS reach,
  COALESCE(a.views,        0) AS views,
  COALESCE(a.video_views,  0) AS video_views,
  COALESCE(a.comments,     0) AS comments,
  COALESCE(a.likes,        0) AS likes,
  COALESCE(a.shares,       0) AS shares,
  COALESCE(a.saves,        0) AS saves,
  COALESCE(a.engagement,   0) AS engagement,
  COALESCE(a.shares, 0) + COALESCE(a.saves, 0) AS shares_saves,
  -- rate metrics: NULL (not 0) on empty days so AVG stays honest
  SAFE_DIVIDE(a.engagement, a.reach) AS engagement_rate,
  SAFE_DIVIDE(a.views,      a.reach) AS frequency
FROM spine s
LEFT JOIN agg a USING (published_date, network, region, market, pauta)
`
  );
});
