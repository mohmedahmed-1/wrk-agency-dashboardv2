// ══════════════════════════════════════════
// META ADS API — LIVE DATA
// ══════════════════════════════════════════
const META_APP_ID = "1340453324644178";
const META_APP_SECRET = "29fd7aec4cfb9c363456cae782831c85";
const MQR_ACCOUNT_ID = "act_248133879022877";
const SHORT_TOKEN =
  "EAA8sGz3Lsl0BRfDdnZAbAtcVZAAxCTFzGZBeMZBLLLU0qQEA2yGPdFzYI8Bd4ImLkWm7IUAqX6ZAN2SThTmEK37o6GsUW1QjbXXBdWSSE62mCS3I3eX2TUnBqQveRRo8ZB5ZB00OaD9O20DSm0V1BYJRWEZBbEZB4Nx5dgNZC8UAvT4jatDDyCu1SLPZAAbHlxm"; // Long-lived · expires ~60 days from 3 May 2026

let LIVE_TOKEN = null;
let apiDataLoaded = false;

// ─── Get Long-Lived Token ───
async function getLongToken() {
  try {
    const resp = await fetch(
      `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}` +
        `&fb_exchange_token=${SHORT_TOKEN}`,
    );
    const data = await resp.json();
    if (data.access_token) {
      LIVE_TOKEN = data.access_token;
      return true;
    }
    console.warn("Token exchange failed, using token directly:", data);
  } catch (e) {
    console.warn("Token exchange error, using token directly:", e.message);
  }
  // Fallback: use token as-is (works if already long-lived or same-app token)
  LIVE_TOKEN = SHORT_TOKEN;
  return true;
}

// ─── Fetch Ads Data (with pagination) ───
async function fetchAdsData() {
  if (!LIVE_TOKEN) return null;
  try {
    const fieldsRaw = `id,name,status,adset{name},insights.time_range({"since":"2026-04-01","until":"2026-04-30"}){impressions,clicks,ctr,spend,actions,cost_per_action_type}`;
    let url = `https://graph.facebook.com/v25.0/${MQR_ACCOUNT_ID}/ads?fields=${encodeURIComponent(fieldsRaw)}&limit=100&access_token=${LIVE_TOKEN}`;
    let allData = [];
    let pages = 0;
    while (url && pages < 5) {
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.error) return json;
      if (json.data) allData = allData.concat(json.data);
      url = json.paging?.next || null;
      pages++;
    }
    return { data: allData };
  } catch (e) {
    console.error("Ads fetch failed:", e);
    return null;
  }
}

// ─── Process Ads Data ───
function processAdsData(rawData) {
  if (!rawData?.data) return null;

  const ads = rawData.data.map((ad) => {
    const ins = ad.insights?.data?.[0];
    const leads = parseInt(
      ins?.actions?.find((a) => a.action_type === "lead")?.value || "0",
    );
    const clicks = parseInt(ins?.clicks || "0");
    const impr = parseInt(ins?.impressions || "0");
    const cpl = parseFloat(
      ins?.cost_per_action_type?.find((a) => a.action_type === "lead")?.value ||
        "0",
    );
    const ctr = parseFloat(ins?.ctr || "0");
    const spend = parseFloat(ins?.spend || "0");
    const adset = ad.adset?.name || "";
    const adL = adset.toLowerCase();
    // Arabic: named "arabic", "arab", or "reels"/"reel" (Egypt market = Arabic by default)
    const isArabic =
      adL.includes("arabic") ||
      adL.includes("arab") ||
      adL.includes("reel") ||
      (adL.includes("broad") && !adL.includes("english"));
    const isEnglish = adL.includes("english");
    return {
      id: ad.id,
      name: ad.name,
      adset,
      leads,
      clicks,
      impr,
      cpl,
      ctr,
      spend,
      isArabic,
      isEnglish,
      status: ad.status,
    };
  });

  // Sort by leads
  const topAds = ads
    .filter((a) => a.leads > 0)
    .sort((a, b) => b.leads - a.leads);

  // Arabic vs English split (English takes priority if both match)
  const english = ads.filter((a) => a.isEnglish);
  const arabic = ads.filter((a) => a.isArabic && !a.isEnglish);

  const arLeads = arabic.reduce((s, a) => s + a.leads, 0);
  const enLeads = english.reduce((s, a) => s + a.leads, 0);
  const arSpend = arabic.reduce((s, a) => s + a.spend, 0);
  const enSpend = english.reduce((s, a) => s + a.spend, 0);
  const arCpl = arLeads > 0 ? arSpend / arLeads : 0;
  const enCpl = enLeads > 0 ? enSpend / enLeads : 0;

  // Top Arabic ads
  const topArabic = arabic
    .filter((a) => a.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);
  const topEnglish = english
    .filter((a) => a.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);

  return {
    topAds,
    arLeads,
    enLeads,
    arSpend,
    enSpend,
    arCpl,
    enCpl,
    topArabic,
    topEnglish,
  };
}

// ─── Update Best Creative section ───
function updateCreativeSection(processed) {
  const top3 = processed.topAds.slice(0, 3);
  const medals = ["🏆 #01 · Best Performer", "#02", "#03"];

  top3.forEach((ad, i) => {
    // Update rank
    const rankEl = document.getElementById("creative-rank-" + i);
    if (rankEl) rankEl.textContent = medals[i];

    // Update name + adset badge
    const nameEl = document.getElementById("creative-name-" + i);
    if (nameEl) {
      const lang = ad.isArabic ? "🇸🇦 Arabic" : ad.isEnglish ? "🇬🇧 English" : "";
      nameEl.innerHTML = `${ad.name}<br><small style="font-size:10px;color:var(--muted);font-weight:400;">${ad.adset}${lang ? " · " + lang : ""}</small>`;
    }

    // Update KPIs
    const setKpi = (id, val, cls) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
        if (cls) el.className = "cr-kpi-val " + cls;
      }
    };
    setKpi(`c${i}-ctr`, ad.ctr.toFixed(2) + "%", ad.ctr > 2 ? "good" : "");
    setKpi(
      `c${i}-cpl`,
      ad.cpl.toFixed(0) + " EGP",
      ad.cpl < 130 ? "good" : ad.cpl > 200 ? "bad" : "",
    );
    setKpi(`c${i}-leads`, ad.leads.toString(), "good");
    setKpi(
      `c${i}-adset`,
      ad.isArabic
        ? "Arabic"
        : ad.isEnglish
          ? "English"
          : ad.adset.split(" ")[0],
      "",
    );

    // Load thumbnail / video preview
    const thumbEl = document.getElementById("creative-thumb-" + i);
    if (thumbEl) loadCreativeThumbnail(thumbEl, ad, i);

    // Why it wins
    if (i === 0) {
      const whyEl = document.getElementById("creative-why-0");
      const whyText = document.getElementById("creative-why-text-0");
      if (whyEl && whyText) {
        whyText.innerHTML = getWhyWins(ad, processed);
        whyEl.style.display = "block";
      }
      document.getElementById("creative-card-0")?.classList.add("winner");
    }
  });

  // Update insight
  const insightEl = document.querySelector(
    "#panel-mqr .creative-grid + .insight",
  );
  if (insightEl && top3[0]) {
    const w = top3[0];
    insightEl.className = "insight good";
    insightEl.innerHTML = `<b>Live from Ads Manager:</b> Best creative is "<b>${w.name}</b>" from ad set <b>${w.adset}</b> — <b>${w.leads} leads</b>, CPL <b>${w.cpl.toFixed(0)} EGP</b>, CTR <b>${w.ctr.toFixed(2)}%</b>. Scale the winner. Kill the rest.`;
  }
}

// ─── Load creative thumbnail / video ───
async function loadCreativeThumbnail(containerEl, ad, rank) {
  if (!LIVE_TOKEN || !ad.id) return;

  try {
    // Fetch creative details including thumbnail and video
    const resp = await fetch(
      `https://graph.facebook.com/v25.0/${ad.id}?fields=creative{thumbnail_url,video_id,object_story_spec,image_url}&access_token=${LIVE_TOKEN}`,
    );
    const data = await resp.json();
    const creative = data?.creative;

    if (!creative) {
      showPlaceholder(containerEl, rank);
      return;
    }

    const thumbUrl = creative.thumbnail_url || creative.image_url;
    const videoId = creative.video_id;

    if (videoId) {
      // Video creative — show thumbnail with play button overlay
      const imgSrc =
        thumbUrl ||
        `https://graph.facebook.com/v25.0/${videoId}/thumbnails?access_token=${LIVE_TOKEN}`;
      containerEl.innerHTML = `
        <div style="position:relative;cursor:pointer;" onclick="openVideoPreview('${videoId}', '${LIVE_TOKEN}')">
          <img src="${imgSrc}" style="width:100%;height:180px;object-fit:cover;display:block;" 
               onerror="this.parentElement.parentElement.innerHTML='<div class=\'api-pending\'><div class=\'api-pending-icon\'>🎬</div><div class=\'api-pending-text\'>Video Creative</div></div>'"
               alt="Video thumbnail">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25);">
            <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.3);">
              <div style="font-size:20px;margin-left:4px;">▶</div>
            </div>
          </div>
          <div style="position:absolute;top:8px;left:8px;background:var(--ink);color:#fff;font-family:var(--ff-mono);font-size:8px;letter-spacing:1px;padding:3px 7px;text-transform:uppercase;">VIDEO</div>
        </div>`;
    } else if (thumbUrl) {
      // Image creative
      containerEl.innerHTML = `
        <div style="position:relative;">
          <img src="${thumbUrl}" style="width:100%;height:180px;object-fit:cover;display:block;"
               onerror="this.parentElement.parentElement.innerHTML='<div class=\'api-pending\'><div class=\'api-pending-icon\'>🖼</div><div class=\'api-pending-text\'>Image Creative</div></div>'"
               alt="Ad creative">
          <div style="position:absolute;top:8px;left:8px;background:var(--ink);color:#fff;font-family:var(--ff-mono);font-size:8px;letter-spacing:1px;padding:3px 7px;text-transform:uppercase;">IMAGE</div>
        </div>`;
    } else {
      showPlaceholder(containerEl, rank);
    }
  } catch (e) {
    showPlaceholder(containerEl, rank);
  }
}

function showPlaceholder(el, rank) {
  const icons = ["🏆", "🥈", "🥉"];
  el.innerHTML = `<div class="api-pending"><div class="api-pending-icon">${icons[rank] || "🖼"}</div><div class="api-pending-text">Preview not available</div></div>`;
}

function openVideoPreview(videoId, token) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;";
  overlay.innerHTML = `<div style="position:relative;max-width:600px;width:90%;"><video src="https://graph.facebook.com/v25.0/${videoId}?fields=source&access_token=${token}" style="width:100%;border-radius:4px;" controls autoplay onerror="this.parentElement.innerHTML='<p style=\'color:#fff;text-align:center;\'>Video preview not available — open in Ads Manager</p>'"></video><div style="text-align:center;margin-top:12px;font-family:var(--ff-mono);font-size:11px;color:rgba(255,255,255,.5);">Click anywhere to close</div></div>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ─── Why this creative wins ───
function getWhyWins(ad, processed) {
  const reasons = [];
  const allAds = processed.topAds;
  const avgCpl = allAds.reduce((s, a) => s + a.cpl, 0) / allAds.length;
  const avgCtr = allAds.reduce((s, a) => s + a.ctr, 0) / allAds.length;
  const avgLeads = allAds.reduce((s, a) => s + a.leads, 0) / allAds.length;

  if (ad.leads > avgLeads * 1.5)
    reasons.push(
      `<b>Highest lead volume</b> (${ad.leads} leads — ${((ad.leads / avgLeads - 1) * 100).toFixed(0)}% above average)`,
    );
  if (ad.cpl < avgCpl * 0.85)
    reasons.push(
      `<b>Lowest CPL</b> (${ad.cpl.toFixed(0)} EGP vs ${avgCpl.toFixed(0)} EGP avg)`,
    );
  if (ad.ctr > avgCtr * 1.3)
    reasons.push(
      `<b>Highest CTR</b> (${ad.ctr.toFixed(2)}% vs ${avgCtr.toFixed(2)}% avg)`,
    );
  if (ad.isArabic && ad.leads > 100)
    reasons.push("<b>Arabic creative</b> driving strong local market response");
  if (ad.isEnglish && ad.cpl < 150)
    reasons.push(
      "<b>English creative</b> reaching higher-intent audience at efficient CPL",
    );
  if (reasons.length === 0)
    reasons.push(
      `Top performer with <b>${ad.leads} leads</b> at <b>${ad.cpl.toFixed(0)} EGP CPL</b>`,
    );

  return reasons.join(" · ");
}

// ─── Status indicator ───
function showApiStatus(status, msg) {
  let bar = document.getElementById("api-status-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "api-status-bar";
    bar.style.cssText = `
      position:fixed; bottom:16px; right:16px;
      background:var(--ink); color:#fff;
      font-family:var(--ff-mono); font-size:10px;
      letter-spacing:1px; padding:8px 14px;
      z-index:9999; display:flex; align-items:center; gap:8px;
      border-left:3px solid var(--green);
      transition: opacity .5s;
    `;
    document.body.appendChild(bar);
  }
  const colors = { loading: "#C47B1A", success: "#2A7D5F", error: "#E84B35" };
  bar.style.borderLeftColor = colors[status] || colors.loading;
  bar.innerHTML = `<div style="width:6px;height:6px;border-radius:50%;background:${colors[status]};animation:tdot 1.5s infinite;"></div> ${msg}`;

  if (status === "success") {
    setTimeout(() => {
      bar.style.opacity = "0";
      setTimeout(() => bar.remove(), 600);
    }, 4000);
  }
}

// ─── Main API loader ───
async function loadLiveData() {
  if (apiDataLoaded) return;

  showApiStatus("loading", "Meta API · Loading data...");

  const tokenOk = await getLongToken();
  if (!tokenOk) {
    showApiStatus("error", "Meta API · Token failed");
    return;
  }

  showApiStatus("loading", "Meta API · Fetching ads...");

  const rawData = await fetchAdsData();
  if (!rawData || rawData.error) {
    showApiStatus(
      "error",
      "Meta API · Fetch failed — " + (rawData?.error?.message || "Error"),
    );
    return;
  }

  const processed = processAdsData(rawData);
  if (!processed) {
    showApiStatus("error", "Meta API · No data");
    return;
  }

  // Update best creative section
  updateCreativeSection(processed);

  // Update Arabic vs English comparison using Meta API data
  // Close rate comes from sheet data (if loaded), CPL from Meta
  const sheetClosed = sheetData?.rows || [];
  const getCloseRate = (isArabic) => {
    if (!sheetClosed.length) return 0;
    const H = sheetData.headers;
    const srcCol = H.find((h) => h && h.toLowerCase().includes("lead source"));
    const stageCol = H.find((h) => h && h.toLowerCase().includes("deal stage"));
    if (!srcCol || !stageCol) return 0;
    // Arabic leads tend to come via Meta Form; English via Website — approximate split
    const closed = sheetClosed.filter(
      (r) => (r[stageCol] || "").trim() === "Deal Closed",
    ).length;
    return closed / Math.max(sheetClosed.length, 1);
  };

  const arLeads = processed.arLeads || 0;
  const enLeads = processed.enLeads || 0;
  const totalApiLeads = arLeads + enLeads || 1;
  const arCloseRate = arLeads > 0 ? getCloseRate(true) : 0;
  const enCloseRate = enLeads > 0 ? getCloseRate(false) : 0;

  updateLangComparison(
    {
      leads: arLeads,
      spend: processed.arSpend,
      cpl: processed.arCpl,
      closed: Math.round(
        (sheetData?.rows?.length || 0) *
          (arLeads / totalApiLeads) *
          arCloseRate,
      ),
      closeRate: arCloseRate,
      relevantRate: arLeads / totalApiLeads,
      topAdsets: processed.topArabic.map((a) => ({
        name: a.adset || a.name,
        leads: a.leads,
      })),
    },
    {
      leads: enLeads,
      spend: processed.enSpend,
      cpl: processed.enCpl,
      closed: Math.round(
        (sheetData?.rows?.length || 0) *
          (enLeads / totalApiLeads) *
          enCloseRate,
      ),
      closeRate: enCloseRate,
      relevantRate: enLeads / totalApiLeads,
      topAdsets: processed.topEnglish.map((a) => ({
        name: a.adset || a.name,
        leads: a.leads,
      })),
    },
  );

  // Update combined Meta + Google section with live Meta data
  const totalMetaSpend = processed.topAds.reduce((s, a) => s + a.spend, 0);
  const totalMetaLeads = arLeads + enLeads;
  const metaAprCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 14;
  const setText2 = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText2(
    "meta-apr-spend",
    (totalMetaSpend > 0
      ? Math.round(totalMetaSpend).toLocaleString()
      : "97,254") + " EGP",
  );
  setText2(
    "meta-apr-leads",
    totalMetaLeads > 0 ? totalMetaLeads.toLocaleString() : "7,160",
  );
  setText2(
    "meta-apr-cpl",
    (totalMetaLeads > 0 ? Math.round(metaAprCpl) : 14) + " EGP",
  );
  setText2(
    "meta-apr-split",
    `${arLeads.toLocaleString()} / ${enLeads.toLocaleString()}`,
  );

  apiDataLoaded = true;
  showApiStatus(
    "success",
    `Meta API ✓ · ${processed.topAds.length} ads · AR:${arLeads} EN:${enLeads} leads`,
  );
}

// ─── TAB SWITCHING ───
function switchTab(id, btn) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("on"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("on"));
  btn.classList.add("on");
  document.getElementById("panel-" + id).classList.add("on");
  initCharts();
}

// ─── SPLASH ───
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    document.getElementById("splash").classList.add("out");
    document.getElementById("app").classList.add("on");
    setTimeout(() => {
      document.getElementById("splash").remove();
      initCharts();
      buildAllBars();
      buildFunnels();
      // Load live data from Meta API
      loadLiveData();
      // Load leads from Google Sheet
      // loadSheetData();  // disabled — no sheet URL configured
    }, 700);
  }, 2400);
});

// ─── CHART DEFAULTS ───
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.color = "#7A8695";

const tt = {
  backgroundColor: "#1B2A3B",
  borderColor: "rgba(27,42,59,0.3)",
  borderWidth: 1,
  titleColor: "#fff",
  bodyColor: "#9baec8",
  padding: 12,
  cornerRadius: 2,
};

// ─── DATA ───
const days = [
  "Apr 1",
  "Apr 2",
  "Apr 3",
  "Apr 4",
  "Apr 5",
  "Apr 6",
  "Apr 7",
  "Apr 8",
  "Apr 9",
  "Apr 10",
  "Apr 11",
  "Apr 12",
  "Apr 13",
  "Apr 14",
  "Apr 15",
  "Apr 16",
  "Apr 17",
  "Apr 18",
  "Apr 19",
  "Apr 20",
  "Apr 21",
  "Apr 22",
  "Apr 23",
  "Apr 24",
  "Apr 25",
  "Apr 26",
  "Apr 27",
  "Apr 28",
  "Apr 29",
  "Apr 30",
];
const metaLeads = [
  0,
  6,
  0,
  0,
  26,
  17,
  24,
  15,
  20,
  21,
  21,
  22,
  33,
  50,
  28,
  19,
  36,
  22,
  33,
  38,
  30,
  23,
  25,
  29,
  32,
  21,
  31,
  30,
  24,
  null,
];
const googleLeads = [
  4,
  23,
  10,
  4,
  4,
  7,
  7,
  5,
  7,
  4,
  8,
  3,
  9,
  3,
  7,
  7,
  6,
  4,
  8,
  6,
  6,
  4,
  9,
  8,
  4,
  6,
  9,
  3,
  13,
  null,
];
const dmLeads = [
  3,
  2,
  3,
  1,
  6,
  4,
  4,
  5,
  4,
  3,
  1,
  6,
  2,
  4,
  4,
  0,
  0,
  3,
  3,
  5,
  11,
  5,
  3,
  3,
  3,
  5,
  4,
  8,
  2,
  null,
];
const blendedCpl = [
  176,
  157,
  242,
  548,
  103,
  112,
  122,
  149,
  112,
  154,
  144,
  166,
  113,
  98,
  120,
  234,
  133,
  190,
  170,
  99,
  87,
  149,
  247,
  226,
  238,
  267,
  194,
  201,
  143,
  null,
];
const metaCpl = [
  null,
  233,
  null,
  null,
  54,
  104,
  106,
  173,
  112,
  151,
  152,
  167,
  121,
  107,
  161,
  181,
  100,
  145,
  129,
  128,
  137,
  171,
  175,
  156,
  136,
  164,
  179,
  153,
  161,
  null,
];
// googleCpl = daily search spend ÷ estimated sheet leads per day (source: Google Ads CSV + lead sheet)
const googleCpl = [
  205,
  149,
  147,
  610,
  578,
  194,
  247,
  225,
  175,
  281,
  139,
  491,
  112,
  69,
  26,
  379,
  331,
  553,
  401,
  null,
  null,
  211,
  530,
  566,
  1155,
  850,
  332,
  1150,
  128,
  null,
];
// cumGoogle = cumulative Google Ads spend (all campaigns) — exact from Google Ads Time Series CSV
const cumGoogle = [
  820, 4255, 5728, 8169, 10480, 11837, 13563, 14690, 15912, 17036, 18150, 19622,
  20626, 20832, 21015, 23667, 25654, 27866, 31074, 31074, 31074, 31916, 36689,
  41213, 45833, 50931, 53926, 57375, 59045, 64718,
];
const cumMeta = [
  415, 1814, 3484, 3813, 5208, 6981, 9514, 12115, 14357, 17535, 20736, 24411,
  28395, 33749, 38254, 41687, 45285, 48481, 52753, 57624, 61724, 65662, 70041,
  74570, 78920, 82364, 87900, 92497, 96364, 97254,
];
const cumTotal = [
  1235, 6069, 9212, 11982, 15688, 18818, 23077, 26805, 30269, 34571, 38886,
  44033, 49021, 54581, 59269, 65354, 70939, 76347, 83827, 88698, 92798, 97578,
  106730, 115783, 124753, 133295, 141826, 149872, 155409, 161972,
];

let chartsBuilt = false;

function initCharts() {
  if (chartsBuilt) return;
  chartsBuilt = true;

  initLangComparisonChart();

  // MQR Daily Stacked
  const dailyEl = document.getElementById("mqr-daily");
  if (dailyEl) {
    new Chart(dailyEl, {
      type: "bar",
      data: {
        labels: days,
        datasets: [
          {
            label: "Meta",
            data: metaLeads,
            backgroundColor: "#E84B35",
            borderRadius: 2,
            stack: "s",
          },
          {
            label: "Google",
            data: googleLeads,
            backgroundColor: "#2A7D5F",
            borderRadius: 2,
            stack: "s",
          },
          {
            label: "DMs",
            data: dmLeads,
            backgroundColor: "#2563A8",
            borderRadius: 2,
            stack: "s",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              font: { size: 10 },
              boxWidth: 8,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...tt,
            callbacks: {
              footer: (items) =>
                "Total: " + items.reduce((a, b) => a + b.parsed.y, 0),
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true, font: { size: 8 } },
          },
          y: {
            stacked: true,
            grid: { color: "rgba(27,42,59,0.06)" },
            ticks: { font: { size: 9 } },
          },
        },
      },
    });
  }

  // ROI Comparison
  const roiEl = document.getElementById("mqr-roi");
  if (roiEl) {
    new Chart(roiEl, {
      type: "bar",
      data: {
        labels: ["CPL (cost/lead)", "Cost per Closed Deal"],
        datasets: [
          {
            label: "Google",
            data: [133, 3939],
            backgroundColor: "#2A7D5F",
            borderRadius: 3,
          },
          {
            label: "Meta",
            data: [143, 4228],
            backgroundColor: "#E84B35",
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              font: { size: 10 },
              boxWidth: 8,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...tt,
            callbacks: {
              label: (c) =>
                c.dataset.label + ": " + c.raw.toLocaleString() + " EGP",
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, weight: "600" } },
          },
          y: {
            type: "logarithmic",
            grid: { color: "rgba(27,42,59,0.06)" },
            ticks: {
              font: { size: 9 },
              callback: (v) => v.toLocaleString() + " EGP",
            },
          },
        },
      },
    });
  }

  // Daily CPL
  const cplEl = document.getElementById("mqr-daily-cpl");
  if (cplEl) {
    new Chart(cplEl, {
      type: "line",
      data: {
        labels: days,
        datasets: [
          {
            label: "Google CPL",
            data: googleCpl,
            borderColor: "#2A7D5F",
            backgroundColor: "rgba(42,125,95,0.06)",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2,
            spanGaps: true,
          },
          {
            label: "Meta CPL",
            data: metaCpl,
            borderColor: "#E84B35",
            backgroundColor: "rgba(232,75,53,0.06)",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2,
            spanGaps: true,
          },
          {
            label: "Blended",
            data: blendedCpl,
            borderColor: "#1B2A3B",
            borderWidth: 1.5,
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              font: { size: 10 },
              boxWidth: 8,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...tt,
            callbacks: {
              label: (c) =>
                c.dataset.label + ": " + (c.raw ? c.raw + " EGP" : "—"),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true, font: { size: 8 } },
          },
          y: {
            grid: { color: "rgba(27,42,59,0.06)" },
            ticks: { font: { size: 9 }, callback: (v) => v + " EGP" },
          },
        },
      },
    });
  }

  // Cumulative
  const cumEl = document.getElementById("mqr-cumulative");
  if (cumEl) {
    new Chart(cumEl, {
      type: "line",
      data: {
        labels: days,
        datasets: [
          {
            label: "Total",
            data: cumTotal,
            borderColor: "#1B2A3B",
            backgroundColor: "rgba(27,42,59,0.08)",
            borderWidth: 2.5,
            tension: 0.3,
            fill: true,
            pointRadius: 0,
          },
          {
            label: "Meta",
            data: cumMeta,
            borderColor: "#E84B35",
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: "Google",
            data: cumGoogle,
            borderColor: "#2A7D5F",
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              font: { size: 10 },
              boxWidth: 8,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...tt,
            callbacks: {
              label: (c) =>
                c.dataset.label + ": " + c.raw.toLocaleString() + " EGP",
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true, font: { size: 8 } },
          },
          y: {
            grid: { color: "rgba(27,42,59,0.06)" },
            ticks: {
              font: { size: 9 },
              callback: (v) => (v / 1000).toFixed(0) + "K EGP",
            },
          },
        },
      },
    });
  }

  // Contact Status
  const contactEl = document.getElementById("mqr-contact");
  if (contactEl) {
    window._contactChart = new Chart(contactEl, {
      type: "doughnut",
      data: {
        labels: [
          "Replied (735)",
          "Attempts (152)",
          "Unreachable (88)",
          "Not Contacted yet",
        ],
        datasets: [
          {
            data: [735, 152, 88, 835],
            backgroundColor: ["#2A7D5F", "#C47B1A", "#E84B35", "#C4BDB3"],
            borderColor: "#fff",
            borderWidth: 3,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "right",
            labels: { font: { size: 9 }, boxWidth: 8, padding: 10 },
          },
          tooltip: { ...tt },
        },
      },
    });
  }

  // TGC Daily
  const tgcDailyEl = document.getElementById("tgc-daily");
  if (tgcDailyEl) {
    new Chart(tgcDailyEl, {
      type: "bar",
      data: {
        labels: [
          "Apr 23",
          "Apr 24",
          "Apr 25",
          "Apr 26",
          "Apr 27",
          "Apr 28",
          "Apr 29",
        ],
        datasets: [
          {
            data: [14, 16, 19, 24, 14, 7, 7],
            backgroundColor: "#2563A8",
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tt } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 } } },
          y: {
            grid: { color: "rgba(27,42,59,0.06)" },
            ticks: { font: { size: 9 } },
          },
        },
      },
    });
  }

  // TGC Source
  const tgcSrcEl = document.getElementById("tgc-source");
  if (tgcSrcEl) {
    window._tgcSourceChart = new Chart(tgcSrcEl, {
      type: "doughnut",
      data: {
        labels: [
          "Meta Form (2,692)",
          "Website (1,535)",
          "DMs (381)",
          "LinkedIn (68)",
        ],
        datasets: [
          {
            data: [2692, 1535, 381, 68],
            backgroundColor: ["#E84B35", "#2A7D5F", "#2563A8", "#C47B1A"],
            borderColor: "#fff",
            borderWidth: 3,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "right",
            labels: { font: { size: 9 }, boxWidth: 8, padding: 8 },
          },
          tooltip: { ...tt },
        },
      },
    });
  }
}

// ══════════════════════════════════════════
// GOOGLE SHEETS INTEGRATION — LEADS DATA
// ══════════════════════════════════════════
// Sheet connection disabled — data loaded from Excel file directly (static/secure mode)
const SHEET_CSV_URL = "";
const SHEET_TGC_URL = "";
const SHEET_URL = "";

// Filter rows to April 2026 only (Date column format: M/D/YYYY HH:MM:SS)
function filterApril2026(rows, dateCol) {
  if (!dateCol) return rows;
  return rows.filter((r) => {
    const d = (r[dateCol] || "").trim();
    return /^4\/\d{1,2}\/2026/.test(d);
  });
}

let sheetData = null;
let sheetLoaded = false;

async function loadSheetData() {
  if (!SHEET_CSV_URL) {
    console.log("Sheet URL not configured — using static data");
    return;
  }
  try {
    showApiStatus("loading", "Google Sheets · Loading MQR leads...");
    const resp = await fetch(SHEET_CSV_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv = await resp.text();
    sheetData = parseCSV(csv);
    sheetLoaded = true;
    updateDashboardFromSheet(sheetData);
    showApiStatus(
      "success",
      `Sheets ✓ · MQR: ${sheetData.rows.length.toLocaleString()} leads`,
    );
    loadTGCSheetData();
  } catch (e) {
    console.warn("MQR sheet load failed:", e.message);
    showApiStatus(
      "error",
      "Google Sheets · Make the sheet public (File → Share → Anyone with link)",
    );
  }
}

async function loadTGCSheetData() {
  try {
    const resp = await fetch(SHEET_TGC_URL);
    if (!resp.ok) return;
    const csv = await resp.text();
    const data = parseCSV(csv);
    if (!data.rows.length) return;
    updateTGCFromSheet(data);
    console.log("TGC sheet loaded:", data.rows.length, "rows");
  } catch (e) {
    console.warn("TGC sheet load failed:", e.message);
  }
}

function updateTGCFromSheet(data) {
  const rows = data.rows;
  const H = data.headers;
  const col = (kws) =>
    H.find(
      (h) => h && kws.some((k) => h.toLowerCase().includes(k.toLowerCase())),
    );
  const countBy = (c) => {
    if (!c) return {};
    const m = {};
    rows.forEach((r) => {
      const v = (r[c] || "").trim();
      if (v) m[v] = (m[v] || 0) + 1;
    });
    return m;
  };

  const total = rows.length;
  const src = countBy(col(["lead source", "source"]));
  const metaL =
    (src["Meta Ads Form"] || 0) +
    (src["Meta Form"] || 0) +
    (src["Meta from"] || 0);
  const webL = Object.keys(src)
    .filter((k) => k.toLowerCase().startsWith("website"))
    .reduce((s, k) => s + src[k], 0);
  const dmL = (src["DM Form"] || 0) + (src["DMs"] || 0) + (src["DM"] || 0);
  const liL = src["LinkedIn"] || 0;

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText("kpi-tgc-val", total.toLocaleString());
  setText(
    "kpi-tgc-sub",
    `Meta: ${metaL.toLocaleString()} · Web: ${webL.toLocaleString()}`,
  );
  setText("tgc-stat-meta", metaL.toLocaleString());
  setText("tgc-stat-website", webL.toLocaleString());
  setText("tgc-stat-dm", dmL.toLocaleString());
  setText("tgc-stat-li", liL.toLocaleString());

  if (window._tgcSourceChart && metaL > 0) {
    window._tgcSourceChart.data.labels = [
      `Meta Form (${metaL.toLocaleString()})`,
      `Website (${webL.toLocaleString()})`,
      `DMs (${dmL.toLocaleString()})`,
      `LinkedIn (${liL})`,
    ];
    window._tgcSourceChart.data.datasets[0].data = [metaL, webL, dmL, liL];
    window._tgcSourceChart.update();
  }

  // TGC quality bars
  const qualCol = col(["lead quality", "quality", "if relevant"]);
  if (qualCol) {
    const qual = countBy(qualCol);
    const qualItems = Object.entries(qual)
      .filter(([k]) => k.length < 40)
      .map(([l, v]) => ({ l: l.trim(), v }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 7);
    if (qualItems.length) buildBar("tgc-quality", qualItems, "blue");
  }
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const rows = lines
    .slice(1)
    .map((line) => {
      const vals =
        line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (vals[i] || "").replace(/"/g, "").trim();
      });
      return row;
    })
    .filter((r) => Object.values(r).some((v) => v));
  return { headers, rows };
}

function updateDashboardFromSheet(data) {
  if (!data || !data.rows.length) return;
  const H = data.headers;

  // Column detection by header name
  const col = (kws) =>
    H.find(
      (h) => h && kws.some((k) => h.toLowerCase().includes(k.toLowerCase())),
    );
  const dateCol = col(["date"]);
  const sourceCol = col(["lead source", "source"]);
  const statusCol = col(["contact status"]);
  const qualityCol = col(["lead quality"]);
  const stageCol = col(["deal stage"]);
  const productCol = col(["product inquiry", "product"]);
  const locationCol = col(["location"]);

  // Filter to April 2026 only
  const rows = filterApril2026(data.rows, dateCol);
  console.log(
    `Sheet filtered to April 2026: ${rows.length} of ${data.rows.length} total rows`,
  );

  const countBy = (c) => {
    if (!c) return {};
    const m = {};
    rows.forEach((r) => {
      const v = (r[c] || "").trim();
      if (v) m[v] = (m[v] || 0) + 1;
    });
    return m;
  };

  const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "—");
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const total = rows.length;

  // ── Sources ──
  const src = countBy(sourceCol);
  const metaLeads =
    (src["Meta Form"] || 0) +
    (src["Meta from"] || 0) +
    (src["Meta Ads Form"] || 0);
  const webLeads = Object.keys(src)
    .filter((k) => k.toLowerCase().startsWith("website"))
    .reduce((s, k) => s + src[k], 0);
  const dmLeads = (src["DMs"] || 0) + (src["DM"] || 0) + (src["DM Form"] || 0);

  setText("kpi-total-val", total.toLocaleString());
  setText("kpi-total-sub", "April 2026 · Live from sheet");
  setText("kpi-meta-val", metaLeads.toLocaleString());
  setText("kpi-meta-sub", pct(metaLeads, total) + " of total");
  setText("kpi-website-val", webLeads.toLocaleString());
  setText("kpi-website-sub", pct(webLeads, total) + " of total");

  // ── Google Ads section: update Search Leads using website source from sheet ──
  const googleSpend = 64716; // Google Ads total spend PMax + Search (April · from CSV)
  const googleCpl = webLeads > 0 ? Math.round(googleSpend / webLeads) : 0;
  setText("gads-leads-sheet", webLeads.toLocaleString());
  setText("gads-cpl-real", googleCpl + " EGP");
  setText(
    "gads-cpl-sub",
    `${googleSpend.toLocaleString()} EGP ÷ ${webLeads} sheet leads`,
  );
  setText("gads-combined-leads", webLeads.toLocaleString());
  setText("gads-combined-cpl", googleCpl + " EGP");

  // ── Lead Quality ──
  const qual = countBy(qualityCol);
  const relevant = (qual["Relevant"] || 0) + (qual["Revelant"] || 0);
  const irrelevant = (qual["Irrelevant"] || 0) + (qual["Not Interested"] || 0);
  const noAnswer = Object.keys(qual)
    .filter(
      (k) =>
        k.toLowerCase().includes("no answer") ||
        k.toLowerCase().includes("unreachable"),
    )
    .reduce((s, k) => s + qual[k], 0);
  const pending = (qual["No Action Yet"] || 0) + (qual["General Inquiry"] || 0);

  setText("q-relevant-num", relevant.toLocaleString());
  setText("q-relevant-pct", pct(relevant, total) + " of total");
  setText("q-potential-num", pending.toLocaleString());
  setText("q-potential-pct", pct(pending, total) + " · pending");
  setText("q-unreachable-num", noAnswer.toLocaleString());
  setText("q-unreachable-pct", pct(noAnswer, total) + " · outreach");
  setText("q-irrelevant-num", irrelevant.toLocaleString());
  setText("q-irrelevant-pct", pct(irrelevant, total) + " disqualified");

  // ── Contact Status ──
  const stat = countBy(statusCol);
  const replied = stat["Replied"] || 0;
  const unreachable = stat["Unreachable"] || 0;
  const attempts =
    (stat["Attempt 1"] || 0) +
    (stat["Attempt 2"] || 0) +
    (stat["Attempt 3"] || 0);
  const notContacted = Math.max(0, total - replied - unreachable - attempts);

  if (window._contactChart) {
    window._contactChart.data.labels = [
      `Replied (${replied})`,
      `Attempts (${attempts})`,
      `Unreachable (${unreachable})`,
      `Not Contacted (${notContacted})`,
    ];
    window._contactChart.data.datasets[0].data = [
      replied,
      attempts,
      unreachable,
      notContacted,
    ];
    window._contactChart.update();
    const contactInsight = document
      .querySelector("#mqr-contact")
      ?.closest(".card")
      ?.querySelector(".insight");
    if (contactInsight && replied > 0) {
      const contacted = replied + attempts + unreachable;
      contactInsight.className = "insight good";
      contactInsight.innerHTML = `<b>${pct(contacted, total)} contacted, ${pct(replied, total)} replied.</b> ${attempts.toLocaleString()} leads in active follow-up — tightening SLA here could surface more relevant prospects.`;
    }
  }

  // ── Deal Stage ──
  const stage = countBy(stageCol);
  const closed = stage["Deal Closed"] || 0;
  const inDiscussion = stage["In Discussions"] || 0;
  const tourQuote =
    (stage["Tour & Meeting"] || 0) + (stage["Quotation Sent"] || 0);

  setText("kpi-closed-val", closed.toLocaleString());
  setText(
    "kpi-closed-sub",
    pct(closed, relevant) + " close rate (of relevant)",
  );

  // ── Funnel (rebuild with live data) ──
  const contacted = replied + attempts + unreachable;
  buildFunnels({
    total,
    contacted,
    replied,
    relevant,
    inDiscussion,
    tourQuote,
    closed,
  });

  const funnelInsight = document.querySelector("#mqr-funnel + .insight");
  if (funnelInsight && closed > 0 && relevant > 0) {
    const closeRate = ((closed / relevant) * 100).toFixed(1);
    const leak =
      inDiscussion > 0 ? ((tourQuote / inDiscussion) * 100).toFixed(0) : 0;
    funnelInsight.className = "insight bad";
    funnelInsight.innerHTML = `<b>${relevant.toLocaleString()} relevant → only ${closed} closed (${closeRate}%).</b> Critical bottleneck: "In Discussions" (${inDiscussion.toLocaleString()}) → "Tour/Quote" (${tourQuote}). Only ${leak}% convert to next stage. Sales motion problem, not a lead problem.`;
  }

  // ── Location bars (live) ──
  const loc = countBy(locationCol);
  const locItems = Object.entries(loc)
    .map(([k, v]) => ({ l: k.trim(), v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
  if (locItems.length) buildBar("mqr-loc", locItems);

  // ── Product bars (live) ──
  const prod = countBy(productCol);
  const prodItems = Object.entries(prod)
    .filter(([k]) => k.length < 45)
    .map(([k, v]) => ({ l: k.trim(), v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 7);
  if (prodItems.length) buildBar("mqr-prod", prodItems, "red");

  // ── Topbar sheet link ──
  const tbRight = document.querySelector(".tb-right");
  if (tbRight && !document.getElementById("sheet-link")) {
    const link = document.createElement("a");
    link.id = "sheet-link";
    link.href = SHEET_URL;
    link.target = "_blank";
    link.style.cssText =
      "font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;color:var(--muted);border:1px solid var(--border);padding:4px 10px;text-decoration:none;display:flex;align-items:center;gap:5px;";
    link.innerHTML = "📊 " + total.toLocaleString() + " leads live";
    tbRight.appendChild(link);
  }

  console.log(
    "Sheet → dashboard updated:",
    total,
    "rows | cols:",
    H.join(", "),
  );
}

// ─── LANG COMPARISON CHART ───
let langChart = null;

function initLangComparisonChart() {
  const el = document.getElementById("lang-comparison-chart");
  if (!el || langChart) return;
  langChart = new Chart(el, {
    type: "bar",
    data: {
      labels: ["CPL (Cost/Lead)", "Cost per Closed Deal"],
      datasets: [
        {
          label: "🇸🇦 Arabic",
          data: [0, 0],
          backgroundColor: "rgba(232,75,53,0.75)",
          borderRadius: 3,
        },
        {
          label: "🇬🇧 English",
          data: [0, 0],
          backgroundColor: "rgba(37,99,168,0.75)",
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            font: { size: 10 },
            boxWidth: 8,
            padding: 12,
            usePointStyle: true,
          },
        },
        tooltip: {
          ...tt,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${c.raw.toLocaleString()} EGP`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, weight: "600" } },
        },
        y: {
          grid: { color: "rgba(27,42,59,0.06)" },
          ticks: {
            font: { size: 9 },
            callback: (v) => v.toLocaleString() + " EGP",
          },
        },
      },
    },
  });
}

// ─── UPDATE LANG COMPARISON FROM DATA ───
function updateLangComparison(arData, enData) {
  // arData / enData = { leads, spend, cpl, closed, closeRate, relevantRate, topAdsets }
  initLangComparisonChart();

  const fmt = (n) => (n > 0 ? Math.round(n).toLocaleString() + " EGP" : "—");
  const pct = (n) => (n > 0 ? (n * 100).toFixed(1) + "%" : "—");

  // Arabic KPIs
  if (document.getElementById("ar-leads"))
    document.getElementById("ar-leads").textContent = arData.leads || "—";
  if (document.getElementById("ar-cpl"))
    document.getElementById("ar-cpl").textContent = fmt(arData.cpl);
  if (document.getElementById("ar-closed"))
    document.getElementById("ar-closed").textContent = arData.closed || "—";
  if (document.getElementById("ar-rate"))
    document.getElementById("ar-rate").textContent = pct(arData.closeRate);
  if (document.getElementById("ar-relevant-pct"))
    document.getElementById("ar-relevant-pct").textContent = pct(
      arData.relevantRate,
    );
  if (document.getElementById("ar-close-pct"))
    document.getElementById("ar-close-pct").textContent = pct(arData.closeRate);
  if (document.getElementById("ar-cpl-compare"))
    document.getElementById("ar-cpl-compare").textContent = fmt(arData.cpl);
  if (document.getElementById("ar-relevant-bar"))
    document.getElementById("ar-relevant-bar").style.width =
      (arData.relevantRate || 0) * 100 + "%";
  if (document.getElementById("ar-close-bar"))
    document.getElementById("ar-close-bar").style.width =
      Math.min((arData.closeRate || 0) * 100 * 10, 100) + "%";

  // English KPIs
  if (document.getElementById("en-leads"))
    document.getElementById("en-leads").textContent = enData.leads || "—";
  if (document.getElementById("en-cpl"))
    document.getElementById("en-cpl").textContent = fmt(enData.cpl);
  if (document.getElementById("en-closed"))
    document.getElementById("en-closed").textContent = enData.closed || "—";
  if (document.getElementById("en-rate"))
    document.getElementById("en-rate").textContent = pct(enData.closeRate);
  if (document.getElementById("en-relevant-pct"))
    document.getElementById("en-relevant-pct").textContent = pct(
      enData.relevantRate,
    );
  if (document.getElementById("en-close-pct"))
    document.getElementById("en-close-pct").textContent = pct(enData.closeRate);
  if (document.getElementById("en-cpl-compare"))
    document.getElementById("en-cpl-compare").textContent = fmt(enData.cpl);
  if (document.getElementById("en-relevant-bar"))
    document.getElementById("en-relevant-bar").style.width =
      (enData.relevantRate || 0) * 100 + "%";
  if (document.getElementById("en-close-bar"))
    document.getElementById("en-close-bar").style.width =
      Math.min((enData.closeRate || 0) * 100 * 10, 100) + "%";

  // Cost per closed deal
  const arCostDeal = arData.closed > 0 ? arData.spend / arData.closed : 0;
  const enCostDeal = enData.closed > 0 ? enData.spend / enData.closed : 0;
  if (document.getElementById("ar-cost-deal"))
    document.getElementById("ar-cost-deal").textContent = fmt(arCostDeal);
  if (document.getElementById("en-cost-deal"))
    document.getElementById("en-cost-deal").textContent = fmt(enCostDeal);

  // Update chart
  if (langChart) {
    langChart.data.datasets[0].data = [
      Math.round(arData.cpl),
      Math.round(arCostDeal),
    ];
    langChart.data.datasets[1].data = [
      Math.round(enData.cpl),
      Math.round(enCostDeal),
    ];
    langChart.update();
  }

  // Verdict — priority: cost-per-deal > CPL > lead volume
  let arWins;
  if (arCostDeal > 0 && enCostDeal > 0) {
    arWins = arCostDeal < enCostDeal;
  } else if (arData.cpl > 0 && enData.cpl > 0) {
    arWins = arData.cpl < enData.cpl; // Lower CPL wins
  } else {
    arWins = arData.leads >= enData.leads; // Higher volume wins
  }

  const arSub =
    arCostDeal > 0
      ? `CPL ${Math.round(arData.cpl)} EGP · ${Math.round(arCostDeal).toLocaleString()} EGP per deal`
      : `${arData.leads.toLocaleString()} leads · CPL ${Math.round(arData.cpl)} EGP`;
  const enSub =
    enCostDeal > 0
      ? `CPL ${Math.round(enData.cpl)} EGP · ${Math.round(enCostDeal).toLocaleString()} EGP per deal`
      : `${enData.leads.toLocaleString()} leads · CPL ${Math.round(enData.cpl)} EGP`;

  const winner = arWins
    ? { name: "🇸🇦 Arabic", sub: arSub }
    : { name: "🇬🇧 English", sub: enSub };
  const loser = arWins
    ? { name: "🇬🇧 English", sub: enSub }
    : { name: "🇸🇦 Arabic", sub: arSub };

  if (document.getElementById("lang-winner-label"))
    document.getElementById("lang-winner-label").textContent =
      "🏆 Better Buyer Source";
  if (document.getElementById("lang-winner-name"))
    document.getElementById("lang-winner-name").textContent = winner.name;
  if (document.getElementById("lang-winner-sub"))
    document.getElementById("lang-winner-sub").textContent = winner.sub;
  if (document.getElementById("lang-loser-name"))
    document.getElementById("lang-loser-name").textContent = loser.name;
  if (document.getElementById("lang-loser-sub"))
    document.getElementById("lang-loser-sub").textContent = loser.sub;

  // Tag badges
  const arTag = document.getElementById("lang-ar-tag");
  const enTag = document.getElementById("lang-en-tag");
  if (arTag) {
    arTag.textContent = arWins ? "✓ WINNER" : "Runner-up";
    arTag.style.background = arWins ? "var(--green)" : "";
    arTag.style.color = arWins ? "#fff" : "";
    arTag.style.borderColor = arWins ? "var(--green)" : "";
  }
  if (enTag) {
    enTag.textContent = !arWins ? "✓ WINNER" : "Runner-up";
    enTag.style.background = !arWins ? "var(--green)" : "";
    enTag.style.color = !arWins ? "#fff" : "";
    enTag.style.borderColor = !arWins ? "var(--green)" : "";
  }

  // Top ad sets bars
  if (arData.topAdsets && document.getElementById("ar-top-adsets")) {
    buildBar(
      "ar-top-adsets",
      arData.topAdsets.map((a) => ({ l: a.name, v: a.leads })),
      "red",
    );
  }
  if (enData.topAdsets && document.getElementById("en-top-adsets")) {
    buildBar(
      "en-top-adsets",
      enData.topAdsets.map((a) => ({ l: a.name, v: a.leads })),
    );
  }

  // Final insight
  const insight = document.getElementById("lang-final-insight");
  if (insight) {
    const cheaperLang = arWins ? "Arabic" : "English";
    const expensiveLang = arWins ? "English" : "Arabic";
    insight.className = "insight good";

    if (arCostDeal > 0 && enCostDeal > 0) {
      const diff = Math.abs(arCostDeal - enCostDeal);
      insight.innerHTML = `<b>Verdict:</b> <b>${cheaperLang}</b> ad sets produce buyers at <b>${Math.round(Math.min(arCostDeal, enCostDeal)).toLocaleString()} EGP per closed deal</b> vs <b>${Math.round(Math.max(arCostDeal, enCostDeal)).toLocaleString()} EGP</b> for ${expensiveLang} — a <b>${Math.round(diff).toLocaleString()} EGP difference per deal</b>. Reallocate budget toward <b>${cheaperLang}</b> creatives immediately.`;
    } else if (arData.cpl > 0 && enData.cpl > 0) {
      const cheaperCpl = Math.min(arData.cpl, enData.cpl);
      const expensiveCpl = Math.max(arData.cpl, enData.cpl);
      const cplDiffPct = (
        ((expensiveCpl - cheaperCpl) / expensiveCpl) *
        100
      ).toFixed(0);
      const winnerLeads = arWins ? arData.leads : enData.leads;
      const loserLeads = arWins ? enData.leads : arData.leads;
      insight.innerHTML = `<b>Verdict:</b> <b>${cheaperLang}</b> wins on both volume and cost — <b>${winnerLeads.toLocaleString()} leads</b> at <b>${Math.round(cheaperCpl)} EGP CPL</b> vs ${expensiveLang}'s ${loserLeads.toLocaleString()} leads at ${Math.round(expensiveCpl)} EGP CPL (${cplDiffPct}% cheaper). However, for the next period we will be <b>scaling English creatives</b> to develop and grow that audience.`;
    }
  }
}

function buildBar(containerId, items, color = "") {
  const el = document.getElementById(containerId);
  if (!el) return;
  const max = Math.max(...items.map((i) => i.v));
  el.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-lbl" title="${item.l}">${item.l}</div>
      <div class="bar-track"><div class="bar-fill ${color}" style="width:${((item.v / max) * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${item.v}</div>
    `;
    el.appendChild(row);
  });
}

function buildAllBars() {
  // ── MQR Location — April 2026 ──
  buildBar("mqr-loc", [
    { l: "Cairo Business Park", v: 258 },
    { l: "Multiple Locations", v: 112 },
    { l: "Maadi - Eco Building", v: 92 },
    { l: "Downtown - GrEEK Campus", v: 86 },
    { l: "October - Melanite Mall", v: 79 },
    { l: "AlRehab Park 15", v: 76 },
    { l: "Zayed - AlRabwa", v: 72 },
    { l: "Madinaty East Hub", v: 51 },
    { l: "Zayed - Eden Mall", v: 48 },
    { l: "AlRehab Gateway Mall", v: 42 },
  ]);

  // ── MQR Product — April 2026 ──
  buildBar(
    "mqr-prod",
    [
      { l: "Offices", v: 442 },
      { l: "Other", v: 173 },
      { l: "Meeting Rooms", v: 119 },
      { l: "Memberships", v: 113 },
      { l: "Workshop Rooms & Events", v: 106 },
      { l: "Corporate Inquiries", v: 27 },
      { l: "Virtual Office", v: 13 },
    ],
    "red",
  );

  // ── MQR Closed by Location — April 2026 ──
  buildBar(
    "mqr-closed-loc",
    [
      { l: "Cairo Business Park", v: 17 },
      { l: "Eden Mall", v: 5 },
      { l: "AlRehab Park 15", v: 3 },
      { l: "Nile City Towers", v: 2 },
      { l: "Downtown GrEEK Campus", v: 2 },
      { l: "AlRehab Gateway Mall", v: 1 },
      { l: "Eco Building", v: 1 },
      { l: "Platz", v: 1 },
      { l: "ElGouna - GSpace", v: 1 },
    ],
    "green",
  );

  // ── MQR Closed by Product — April 2026 ──
  buildBar(
    "mqr-closed-prod",
    [
      { l: "Meeting Rooms", v: 15 },
      { l: "Other", v: 7 },
      { l: "Offices", v: 5 },
      { l: "Workshop Rooms & Events", v: 5 },
      { l: "Memberships", v: 1 },
      { l: "Corporate Inquiries", v: 1 },
    ],
    "amber",
  );

  // ── TGC bars — April 2026 ──
  buildBar(
    "tgc-prod",
    [
      { l: "Workshop Rooms & Events", v: 76 },
      { l: "Offices", v: 34 },
      { l: "Meeting Rooms", v: 9 },
      { l: "Shooting Location", v: 9 },
    ],
    "blue",
  );

  buildBar("tgc-loc", [
    { l: "TGC Downtown — Tahrir", v: 85 },
    { l: "TGC West — Mall of Arabia", v: 41 },
  ]);

  buildBar(
    "tgc-quality",
    [
      { l: "Relevant", v: 38 },
      { l: "No Answer (1 trial)", v: 36 },
      { l: "Irrelevant", v: 15 },
      { l: "No Action Yet", v: 14 },
      { l: "No Answer (2-3 trials)", v: 4 },
      { l: "Unreachable", v: 1 },
    ],
    "blue",
  );

  // AR/EN bars (estimated split)
  buildBar(
    "ar-adsets",
    [
      { l: "Private Offices", v: 198 },
      { l: "Workshops & Events", v: 142 },
      { l: "Meeting Rooms", v: 62 },
      { l: "Memberships", v: 45 },
    ],
    "green",
  );

  buildBar("en-adsets", [
    { l: "Private Offices", v: 88 },
    { l: "Meeting Rooms", v: 74 },
    { l: "Corporate Inquiries", v: 42 },
    { l: "Workshops", v: 25 },
  ]);
}

// ─── FUNNEL ───
function buildFunnels(data) {
  const d = data || {
    total: 997,
    contacted: 947,
    replied: 712,
    relevant: 392,
    inDiscussion: 218,
    tourQuote: 24,
    closed: 34,
  };
  const funnelData = [
    { name: "Total Leads", val: d.total, pct: "baseline" },
    {
      name: "Contacted",
      val: d.contacted,
      pct: ((d.contacted / d.total) * 100).toFixed(1) + "%",
    },
    {
      name: "Replied",
      val: d.replied,
      pct: ((d.replied / d.total) * 100).toFixed(1) + "%",
    },
    {
      name: "Marked Relevant",
      val: d.relevant,
      pct: ((d.relevant / d.total) * 100).toFixed(1) + "%",
    },
    {
      name: "In Discussions",
      val: d.inDiscussion,
      pct: ((d.inDiscussion / d.total) * 100).toFixed(1) + "%",
    },
    {
      name: "Tour or Quotation",
      val: d.tourQuote,
      pct: ((d.tourQuote / d.total) * 100).toFixed(1) + "%",
    },
    {
      name: "Deal Closed ✓",
      val: d.closed,
      pct: ((d.closed / d.total) * 100).toFixed(1) + "%",
    },
  ];

  const el = document.getElementById("mqr-funnel");
  if (!el) return;
  el.innerHTML = "";

  const colors = [
    "#1B2A3B",
    "#2563A8",
    "#2563A8",
    "#C47B1A",
    "#C47B1A",
    "#E84B35",
    "#2A7D5F",
  ];
  funnelData.forEach((item, i) => {
    const w = ((item.val / d.total) * 100).toFixed(1);
    const row = document.createElement("div");
    row.className = "funnel-row";
    row.innerHTML = `
      <div class="funnel-name">${item.name}</div>
      <div class="funnel-track"><div class="funnel-fill" style="width:${w}%;background:${colors[i]}"></div></div>
      <div class="funnel-stat">${item.val.toLocaleString()}<span>${item.pct}</span></div>
    `;
    el.appendChild(row);
  });
}

// ─── REPS ───
function buildReps() {
  const repsVol = [
    { n: "Karim", v: 200, d: 1 },
    { n: "Marwan", v: 113, d: 3 },
    { n: "Mostafa", v: 103, d: 0 },
    { n: "Kelany", v: 84, d: 0 },
    { n: "Malak", v: 66, d: 17 },
    { n: "Maryam", v: 56, d: 0 },
    { n: "Aya", v: 22, d: 2 },
    { n: "Ali", v: 19, d: 0 },
    { n: "Mahmood", v: 17, d: 2 },
    { n: "Islam", v: 17, d: 2 },
  ];

  const volEl = document.getElementById("mqr-reps-vol");
  if (volEl) {
    volEl.innerHTML = repsVol
      .map(
        (r) => `
      <div class="rep-row ${r.n === "Malak" ? "star" : ""}">
        <div class="rep-left">
          <div class="rep-av ${r.n === "Malak" ? "green" : ""}">${r.n[0]}</div>
          <div>
            <div class="rep-name">${r.n}</div>
            <div class="rep-meta">${r.d} closed · ${((r.d / r.v) * 100).toFixed(1)}% close rate</div>
          </div>
        </div>
        <div class="rep-right">${r.v}<span>leads</span></div>
      </div>
    `,
      )
      .join("");
  }

  const repsClosed = [
    { n: "Malak", v: 17, vol: 66 },
    { n: "Youssef", v: 4, vol: 9 },
    { n: "Marwan", v: 3, vol: 113 },
    { n: "Mahmood", v: 2, vol: 17 },
    { n: "Aya", v: 2, vol: 22 },
    { n: "Islam", v: 2, vol: 17 },
    { n: "Karim", v: 1, vol: 200 },
    { n: "Jana", v: 1, vol: 5 },
    { n: "Sherry", v: 1, vol: 8 },
  ];

  const closedEl = document.getElementById("mqr-reps-closed");
  if (closedEl) {
    closedEl.innerHTML = repsClosed
      .map(
        (r, i) => `
      <div class="rep-row">
        <div class="rep-left">
          <div class="rep-av ${i === 0 ? "gold" : ""}" style="${i > 0 ? "background:rgba(255,255,255,.1);color:#fff;" : ""}">${r.n[0]}</div>
          <div>
            <div class="rep-name">${r.n}</div>
            <div class="rep-meta">${r.vol} handled · ${((r.v / r.vol) * 100).toFixed(1)}% close</div>
          </div>
        </div>
        <div class="rep-right">${r.v}<span>closed</span></div>
      </div>
    `,
      )
      .join("");
  }

  const tgcReps = [
    { n: "Mahmood", v: 23 },
    { n: "Kelany", v: 10 },
    { n: "Waleed", v: 7 },
    { n: "Samir", v: 7 },
    { n: "Marwan", v: 6 },
    { n: "Amr", v: 5 },
    { n: "Mostafa", v: 4 },
    { n: "Habiba", v: 2 },
    { n: "Karim", v: 3 },
  ];

  const tgcRepsEl = document.getElementById("tgc-reps");
  if (tgcRepsEl) {
    tgcRepsEl.innerHTML = tgcReps
      .map(
        (r, i) => `
      <div class="rep-row ${i === 0 ? "star" : ""}">
        <div class="rep-left">
          <div class="rep-av ${i === 0 ? "green" : ""}">${r.n[0]}</div>
          <div>
            <div class="rep-name">${r.n}</div>
            <div class="rep-meta">${((r.v / 67) * 100).toFixed(0)}% of assigned leads</div>
          </div>
        </div>
        <div class="rep-right">${r.v}<span>leads</span></div>
      </div>
    `,
      )
      .join("");
  }
}
