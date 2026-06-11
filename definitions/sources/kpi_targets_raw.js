// Source declaration: snapshot del sheet "VISA | Mundial | KPI" (targets por país).
// Lo materializa la scheduled query (infrastructure/scheduled_query_kpi_targets.sql)
// desde ext_kpi_targets. Dataform lo reshapea en dm/kpi_targets.js a metric_id × market.

declare({
  database: "visa-reporting",
  schema: "002_visa_latam_dp",
  name: "kpi_targets_raw",
});
