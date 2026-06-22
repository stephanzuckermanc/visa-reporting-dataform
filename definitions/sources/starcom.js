// Source declaration — starcom_raw: snapshot del Sheet "VISA | DATA Estática"
// (Starcom: contenido PAGADO + INFLUENCER con métricas totales + spend).
//
// Dataform NO puede leer el Sheet directo (sin scope Drive). Una scheduled query
// SEMANAL (Drive-authorized) materializa la external table ext_starcom_paid a esta
// tabla NATIVA, que Dataform lee y parsea.
//
//   Sheet "VISA | DATA Estática" (tab DATA | Statica, + col post_id via Apps Script)
//     -> ext_starcom_paid           (external, infrastructure/external_table_defs/starcom_paid.json)
//     -> [scheduled query semanal]  (infrastructure/scheduled_query_starcom.sql)
//     -> 002_visa_latam_dp.starcom_raw   (native -- declarada acá)
//     -> dm_match_content (+spend a propios; append colab tipo_contenido='Colaboración')
//
// Columnas (todas STRING): published_date, name, creador, esfuerzo, network, format,
// url, inversion_ejecutada (spend), reach, impressions, views, vtr_50, likes, comments,
// shares, engagement, engagement_rate, investment, fuente, post_id.
// post_id = TikTok video id / IG shortcode (key para cruzar con dm_post_performance).

declare({
  database: "visa-reporting",
  schema: "002_visa_latam_dp",
  name: "starcom_raw",
});
