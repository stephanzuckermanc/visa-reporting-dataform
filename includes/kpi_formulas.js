// Per-platform KPI formulas, sourced from "KPIs & plan final data.pdf" pages 9-10.
// These are emitted into SQL — keep them in sync with the glossary memory.

function engagementRate(platform) {
  switch (platform) {
    case "facebook":
      return "SAFE_DIVIDE(reactions + comments + shares + link_clicks, post_reach)";
    case "instagram":
      return "SAFE_DIVIDE(likes + comments + saves, reach)";
    case "x":
    case "twitter":
      return "SAFE_DIVIDE(likes + retweets + replies + link_clicks, post_impressions)";
    case "tiktok":
      return "SAFE_DIVIDE(likes + comments + shares, reach)";
    case "youtube":
    case "linkedin":
      return "SAFE_DIVIDE(likes + comments + shares, post_impressions)";
    default:
      return "CAST(NULL AS FLOAT64)";
  }
}

function shareRate(platform) {
  if (["facebook", "instagram", "tiktok"].includes(platform)) {
    return "SAFE_DIVIDE(shares, post_reach)";
  }
  return "SAFE_DIVIDE(shares, post_impressions)";
}

function viewThroughRate(platform) {
  if (["facebook", "instagram", "tiktok"].includes(platform)) {
    return "SAFE_DIVIDE(video_views_50pct, post_reach)";
  }
  return "SAFE_DIVIDE(video_views_50pct, post_impressions)";
}

module.exports = { engagementRate, shareRate, viewThroughRate };
