// Source declarations for the Social Listening (Brandwatch) Sheet snapshots.
//
// The "VISA | Mentions" Google Sheet (3 tabs) is materialized daily by a
// scheduled query into these NATIVE tables (Dataform can't read Sheets directly
// — no Drive scope). Pipeline:
//
//   Sheet "VISA | Mentions" (Listening / SOV Competidores / SOV Spondors)
//     -> ext_listening / ext_sov_competidores / ext_sov_sponsors  (external,
//        infrastructure/create_listening_external_tables.ps1)
//     -> [scheduled query, Drive-authorized]  (infrastructure/scheduled_query_listening.sql)
//     -> 002_visa_latam_dp.{listening_raw, sov_competidores_raw, sov_sponsors_raw}
//     -> dm_listening / dm_sov
//
// All metric columns land as STRING (varied formats in the Sheet); casting and
// cleanup happen in the dm/ models. `fecha` is a real DATE built from dia/mes/anio.

["listening_raw", "sov_competidores_raw", "sov_sponsors_raw"].forEach((name) => {
  declare({
    database: "visa-reporting",
    schema: "002_visa_latam_dp",
    name,
  });
});
