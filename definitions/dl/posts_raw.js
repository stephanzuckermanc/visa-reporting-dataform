// Data Lake (01X) — posts_raw: first parse of ext_posts.
// One row per record, no dedup. Region encoded in dataset name (one DL dataset per region).
// Iterates 3 regions; produces 011_visa_namer_dl.posts_raw, 012_visa_latam_dl.posts_raw, 013_visa_emea_dl.posts_raw.

const { REGIONS, datasetFor } = require("includes/country_to_region");

REGIONS.forEach((region) => {
  publish("posts_raw", {
    schema: datasetFor("dl", region),
    type: "table",
    description: `First-parse of ext_posts — ${region.toUpperCase()}. One row per record, dups allowed.`,
    bigquery: {
      partitionBy: "ingest_date",
      clusterBy: ["platform"],
    },
  }).query(
    (ctx) => `
SELECT
  JSON_VALUE(payload, "$.id") AS post_id,
  JSON_VALUE(payload, "$.socialProfile.id") AS social_profile_id,
  CASE LOWER(JSON_VALUE(payload, "$.socialProfile.type"))
    WHEN "facebook"          THEN "facebook"
    WHEN "facebookpage"      THEN "facebook"
    WHEN "instagram"         THEN "instagram"
    WHEN "instagrambusiness" THEN "instagram"
    WHEN "twitter"           THEN "x"
    WHEN "twitterv2"         THEN "x"
    WHEN "linkedin"          THEN "linkedin"
    WHEN "linkedincompany"   THEN "linkedin"
    WHEN "youtubechannel"    THEN "youtube"
    WHEN "tiktokbusiness"    THEN "tiktok"
    ELSE LOWER(JSON_VALUE(payload, "$.socialProfile.type"))
  END AS platform,
  SAFE.PARSE_TIMESTAMP("%Y-%m-%dT%H:%M:%E*SZ", JSON_VALUE(payload, "$.sendDate")) AS published_at,
  JSON_VALUE(payload, "$.media[0].type") AS media_type,
  JSON_VALUE(payload, "$.text") AS content_text,
  COALESCE(JSON_VALUE(payload, "$.postUrl"), JSON_VALUE(payload, "$.postUrls[0]")) AS permalink,
  REGEXP_EXTRACT(JSON_VALUE(payload, "$.text"), r"#(VISA[A-Z0-9_]+)") AS campaign_tag,
  PARSE_DATE("%Y-%m-%d", dt) AS ingest_date,
  CURRENT_TIMESTAMP() AS _loaded_at
FROM ${ctx.ref(`ext_posts_${region}`)}
`
  );
});
