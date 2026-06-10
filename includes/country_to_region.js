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

// Sub-región comercial dentro de LATAM (los 3 "markets" del Mundial: Mexico /
// CarCam / Andino). Es el mismo agrupamiento de las tabs del Sheet del Mundial y
// del KPI sheet por región. Se deriva del `country` del post. Países aún no
// conectados quedan previstos para que entren solos al conectarse.
const COUNTRY_TO_MARKET = {
  // Mexico
  MX: "mexico",
  // Andino
  CO: "andino", EC: "andino", PE: "andino", VE: "andino", BO: "andino",
  // CarCam (Centroamérica + Caribe)
  CR: "carcam", DO: "carcam", GT: "carcam", JM: "carcam", PA: "carcam",
  PR: "carcam", SV: "carcam", HN: "carcam", NI: "carcam", TT: "carcam", HT: "carcam",
};

// Overrides por username para perfiles SIN country (multi-país / regionales).
// La página FB del Caribe es claramente CarCam aunque su country venga NULL.
const USERNAME_TO_MARKET = {
  "Visa (TT, JM, HT, ...)": "carcam",
};

/**
 * Returns SQL that maps (country, username) to a LATAM market string
 * (mexico | carcam | andino), or NULL. The username override wins (handles
 * the multi-country Caribbean FB page whose country is NULL); otherwise maps
 * by country. Profiles like "Visa Español" / the null Twitter -> NULL.
 *   Use:  ${marketSQL("country", "username")}  →  CASE ... END
 */
function marketSQL(countryCol = "country", usernameCol = "username") {
  const userCases = Object.entries(USERNAME_TO_MARKET)
    .map(([u, m]) => `    WHEN ${usernameCol} = '${u.replace(/'/g, "\\'")}' THEN '${m}'`)
    .join("\n");
  const countryCases = Object.entries(COUNTRY_TO_MARKET)
    .map(([cc, m]) => `    WHEN UPPER(${countryCol}) = '${cc}' THEN '${m}'`)
    .join("\n");
  return `CASE\n${userCases}\n${countryCases}\n    ELSE NULL\n  END`;
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
  COUNTRY_TO_MARKET,
  USERNAME_TO_MARKET,
  countryToRegionSQL,
  marketSQL,
  datasetFor,
};
