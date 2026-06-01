// Data Warehouse (03X) — 5 views, one per social network.
//
// Each view is a thin slice of dm_post_performance filtered to one network.
// Purpose: convenience for per-network dashboards or analyses (e.g. a
// dedicated TikTok report, a Twitter-only ad-hoc query) without forcing
// every consumer to remember the network filter.
//
// Why views (not tables):
//   - 0 storage cost — they cost nothing to maintain.
//   - Schema automatically inherits any change in dm_post_performance.
//   - BigQuery still applies partition pruning on `published_date` and
//     cluster pruning on `network` (cheap to scan).
//
// To add a new network, just append to NETWORKS below and re-deploy.

const { REGIONS, datasetFor } = require("includes/country_to_region");

// Map: short name → canonical value in dm_post_performance.network
// Keep `id` lowercase — it becomes the table suffix (dw_<id>).
const NETWORKS = [
  { id: "instagram", filter: "INSTAGRAMBUSINESS", label: "Instagram"  },
  { id: "facebook",  filter: "FACEBOOKPAGE",     label: "Facebook"   },
  { id: "twitter",   filter: "TWITTER",          label: "Twitter / X" },
  { id: "tiktok",    filter: "TIKTOKBUSINESS",   label: "TikTok"     },
  { id: "youtube",   filter: "YOUTUBECHANNEL",   label: "YouTube"    },
];

REGIONS.forEach((region) => {
  const dmDataset = datasetFor("dm", region);
  const dwDataset = datasetFor("dw", region);

  NETWORKS.forEach((net) => {
    publish(`dw_${net.id}`, {
      schema: dwDataset,
      type: "view",
      description:
        `${net.label} posts only — filtered view of dm_post_performance (network = '${net.filter}'). ` +
        `Same schema + columns as the parent table. ${region.toUpperCase()}.`,
    }).query(
      (ctx) => `
SELECT *
FROM ${ctx.ref({ schema: dmDataset, name: "dm_post_performance" })}
WHERE network = '${net.filter}'
`
    );
  });
});
