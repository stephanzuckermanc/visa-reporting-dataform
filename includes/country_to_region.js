// Country → region mapping for Visa Hootsuite ETL.
// Used at the dt (data transformation) layer to validate and route posts:
// the workflow tags GCS files with a `region` parameter, but the API also
// returns the post's `country`. This mapping is the source of truth for
// what region a country belongs to.
//
// Keep keys uppercase ISO-3166 alpha-2 codes. Lowercase region values match
// the GCS path and dataset name conventions (latam/namer/emea).
//
// If a new country shows up, add it here AND in the regions[] config below.

// Scope del piloto: solo LATAM. Para reactivar NAMER/EMEA cuando haya
// profiles conectados de esas regiones, agrega "namer" y/o "emea" aquí
// y haz push -- los modelos dl/dt/dm los generarán automáticamente porque
// todo el grafo está hecho con REGIONS.forEach(...).
const REGIONS = ["latam"];

const REGION_NUMBER = {
  namer: "021",
  latam: "022",
  emea: "023",
};

// Country → region mapping. Add countries as Visa expands social profile coverage.
const COUNTRY_TO_REGION = {
  // NAMER
  US: "namer",
  CA: "namer",
  // LATAM
  MX: "latam",
  GT: "latam",
  HN: "latam",
  SV: "latam",
  NI: "latam",
  CR: "latam",
  PA: "latam",
  CO: "latam",
  VE: "latam",
  EC: "latam",
  PE: "latam",
  BO: "latam",
  CL: "latam",
  AR: "latam",
  PY: "latam",
  UY: "latam",
  BR: "latam",
  DO: "latam",
  PR: "latam",
  JM: "latam",
  TT: "latam",
  HT: "latam",
  // EMEA
  ES: "emea",
  GB: "emea",
  UK: "emea",
  FR: "emea",
  DE: "emea",
  IT: "emea",
  PT: "emea",
  NL: "emea",
  BE: "emea",
  CH: "emea",
  AT: "emea",
  IE: "emea",
  SE: "emea",
  NO: "emea",
  DK: "emea",
  FI: "emea",
  PL: "emea",
  CZ: "emea",
  RO: "emea",
  GR: "emea",
  TR: "emea",
  IL: "emea",
  AE: "emea",
  SA: "emea",
  EG: "emea",
  ZA: "emea",
  NG: "emea",
  KE: "emea",
  MA: "emea",
};

/**
 * Returns SQL that maps a country column to a region string.
 * Use inside Dataform SQLX:  ${countryToRegionSQL("country")}  →  CASE WHEN ... END
 */
function countryToRegionSQL(countryCol = "country") {
  const cases = Object.entries(COUNTRY_TO_REGION)
    .map(([cc, reg]) => `    WHEN UPPER(${countryCol}) = '${cc}' THEN '${reg}'`)
    .join("\n");
  return `CASE\n${cases}\n    ELSE NULL\n  END`;
}

/**
 * Dataset name for a layer × region.
 * Examples:
 *   datasetFor("dp", "latam")  →  "002_visa_latam_dp"
 *   datasetFor("dt", "namer")  →  "021_visa_namer_dt"
 *   datasetFor("dm", "emea")   →  "043_visa_emea_dm"
 */
function datasetFor(layer, region) {
  const prefixByLayer = {
    dp: { namer: "001", latam: "002", emea: "003" },
    dl: { namer: "011", latam: "012", emea: "013" },
    dt: { namer: "021", latam: "022", emea: "023" },
    dw: { namer: "031", latam: "032", emea: "033" },
    dm: { namer: "041", latam: "042", emea: "043" },
  };
  const prefix = prefixByLayer[layer]?.[region];
  if (!prefix) {
    throw new Error(`No mapping for layer=${layer} region=${region}`);
  }
  return `${prefix}_visa_${region}_${layer}`;
}

module.exports = {
  REGIONS,
  REGION_NUMBER,
  COUNTRY_TO_REGION,
  countryToRegionSQL,
  datasetFor,
};
