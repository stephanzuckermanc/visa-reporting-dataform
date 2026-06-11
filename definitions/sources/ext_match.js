// Source declaration for the Mundial (FIFA 26) Sheet snapshot.
//
// Dataform CANNOT read the Google-Sheets external tables directly (its service
// account has no Drive OAuth scope, and Sheets sources don't accept a BQ
// connection). So a daily BigQuery scheduled query materializes the 3 Sheet
// tabs into this NATIVE table, which Dataform reads safely.
//
//   Google Sheet (3 tabs)
//     -> ext_match_mx/andino/carcam            (external, created by
//        infrastructure/create_sheets_external_tables.ps1)
//     -> [scheduled query, Drive-authorized]   (infrastructure/scheduled_query_match_sheet.sql)
//     -> 002_visa_latam_dp.match_sheet_raw      (native -- declared here)
//     -> dm_match_content / dm_match_coverage
//
// Columns (all STRING): market, fecha, nombre, link_ig, link_tiktok, autor,
// copy_out, tipo_contenido, pauta_ig, pauta_tiktok.
// (Los tabs por mercado traen 9 cols A:I. La pauta viene partida por plataforma:
//  pauta_ig = col H "Pauta? Instagram", pauta_tiktok = col I "Pauta TikTok?".)

declare({
  database: "visa-reporting",
  schema: "002_visa_latam_dp",
  name: "match_sheet_raw",
});
