# -*- coding: utf-8 -*-
"""
Pull live M-Design numbers (Meta Ads + Shopify) at DAILY granularity across a
rolling 6-month window and inject them into m-design-dashboard.html as a
single DATA constant. The dashboard itself does every rollup (KPIs, trend,
campaigns, ads, products, audience, geo, returns, wholesale) client-side from
this raw daily/order-level data, so the client can pick ANY custom date range
(like Ads Manager) and every section recomputes for it — not just four fixed
presets. No network calls happen in the browser; everything ships baked into
the HTML, and API tokens never leave this script.

Run:  python mdesign_client_dashboard_data.py
"""
import io, json, os, re, sys, time, urllib.request, urllib.parse, urllib.error, ssl
from datetime import datetime, timedelta, timezone, date

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def _load_local_env(path=".env.mdesign"):
    """Tiny KEY=VALUE loader, no dependency — reads a gitignored local file
    so tokens never need to live in source. Doesn't override real env vars."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(p):
        return
    for line in open(p, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_local_env()


def _require_env(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Missing {name}. Set it as an environment variable, or add "
                  f"'{name}=...' to .env.mdesign next to this script (gitignored, never committed).")
    return v


# -------- Meta --------
MTOK  = _require_env("MDESIGN_META_TOKEN")
ACT   = "act_1055264548842096"
GRAPH = "https://graph.facebook.com/v23.0"

# -------- Shopify --------
SHOP  = "m-design-egypt.myshopify.com"
STOK  = _require_env("MDESIGN_SHOPIFY_TOKEN")
SAPI  = "2025-07"

DASHBOARD = r"C:\Users\m_ahm\proj\m-design-dashboard.html"
CAIRO = timezone(timedelta(hours=3))

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]
LOW_STOCK_THRESHOLD = 15
MAX_LOOKBACK_DAYS = 183  # ~6 months — matches the client's pickable date-range floor


def clean_title(s):
    """Shopify lets staff paste titles with stray newlines/tabs; collapse
    to single spaces so they render as one line in the report."""
    return re.sub(r"\s+", " ", (s or "").strip())


# ---------------------------------------------------------------- Meta ----
def _transient_meta_error(body_bytes):
    """Meta's error code 2 ('unknown error occurred') and 5xx are documented
    as retry-worthy even though Meta sometimes ships code 2 on an HTTP 400
    with is_transient:false — the flag is unreliable for this code."""
    try:
        err = json.loads(body_bytes).get("error", {})
    except Exception:
        return False
    return err.get("code") == 2 or err.get("is_transient") is True


def meta(node, **params):
    p = dict(params); p["access_token"] = MTOK
    url = f"{GRAPH}/{node}?{urllib.parse.urlencode(p)}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, context=ctx, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read()
            if e.code >= 500 or _transient_meta_error(body):
                time.sleep(2 * (attempt + 1))
                continue
            sys.exit(f"Meta API error {e.code}: {body.decode()[:400]}")
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * (attempt + 1))
            continue
    sys.exit("Meta unreachable after retries")


def action_val(actions, types=PURCHASE_TYPES):
    if not actions:
        return 0.0
    by_type = {a.get("action_type"): float(a.get("value") or 0) for a in actions}
    for t in types:
        if t in by_type:
            return by_type[t]
    return 0.0


def meta_insights(since, until, level=None, time_increment=None, limit=None, breakdowns=None):
    fields = "spend,impressions,clicks,actions,action_values"
    p = dict(time_range=json.dumps({"since": since, "until": until}), fields=fields)
    if level:
        p["fields"] = "campaign_name,ad_name,adset_name,ad_id," + fields
        p["level"] = level
    if time_increment:
        p["time_increment"] = time_increment
    if limit:
        p["limit"] = limit
    if breakdowns:
        p["breakdowns"] = breakdowns
    def fetch_page(url):
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, context=ctx, timeout=90) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                body = e.read()
                if e.code < 500 and not _transient_meta_error(body):
                    sys.exit(f"Meta API error {e.code}: {body.decode()[:400]}")
                time.sleep(2 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError):
                time.sleep(2 * (attempt + 1))
        sys.exit("Meta unreachable after retries")

    out = []
    d = meta(f"{ACT}/insights", **p)
    out.extend(d.get("data", []))
    nxt = (d.get("paging") or {}).get("next")
    while nxt:
        d = fetch_page(nxt)
        out.extend(d.get("data", []))
        nxt = (d.get("paging") or {}).get("next")
    return out


def chunked_ranges(since_d, until_d, chunk_days=30):
    """Meta's insights API gets flaky/slow on wide time_increment=1 pulls
    over many entities (ad-level especially) — split into smaller windows
    so one bad response doesn't sink the whole run."""
    out, d = [], since_d
    while d <= until_d:
        chunk_end = min(d + timedelta(days=chunk_days - 1), until_d)
        out.append((d.isoformat(), chunk_end.isoformat()))
        d = chunk_end + timedelta(days=1)
    return out


def meta_insights_chunked(since_d, until_d, chunk_days=30, **kwargs):
    rows = []
    chunks = chunked_ranges(since_d, until_d, chunk_days)
    for i, (cs, ce) in enumerate(chunks, 1):
        print(f"    chunk {i}/{len(chunks)}: {cs} → {ce}")
        rows.extend(meta_insights(cs, ce, **kwargs))
    return rows


def row_metrics(row):
    return {
        "spend": round(float(row.get("spend") or 0), 2),
        "impressions": int(float(row.get("impressions") or 0)),
        "clicks": int(float(row.get("clicks") or 0)),
        "purchases": round(action_val(row.get("actions"))),
        "purchaseValue": round(action_val(row.get("action_values")), 2),
    }


def fetch_ad_info(ad_id, cache):
    """Creative preview image + ad creation date, one call per ad_id.
    thumbnail_width/height is requested explicitly at 720px: Collection,
    catalog/Advantage+ and other dynamic-creative ad types often have no
    image_url/object_story_spec/asset_feed_spec at all, and their only real
    fallback (thumbnail_url) used to get thrown away here for looking like a
    tiny 64x64 icon — asking Meta for a large thumbnail up front fixes both
    problems: it's the fallback these ad types actually have, and it's no
    longer small enough to reject."""
    if ad_id in cache:
        return cache[ad_id]
    try:
        r = meta(ad_id, fields="created_time,"
                                "creative.thumbnail_width(720).thumbnail_height(720)"
                                "{image_url,thumbnail_url,"
                                "object_story_spec{link_data{picture},video_data{image_url}},"
                                "asset_feed_spec{images{url}}}")
    except SystemExit:
        cache[ad_id] = {"image": None, "createdTime": None}
        return cache[ad_id]
    c = r.get("creative", {}) or {}
    cands = [c.get("image_url")]
    oss = c.get("object_story_spec", {}) or {}
    if oss.get("link_data"):
        cands.append(oss["link_data"].get("picture"))
    if oss.get("video_data"):
        cands.append(oss["video_data"].get("image_url"))
    afs = c.get("asset_feed_spec", {}) or {}
    if afs.get("images"):
        cands.append(afs["images"][0].get("url"))
    cands.append(c.get("thumbnail_url"))
    url = next((u for u in cands if u), None)
    created = r.get("created_time")
    info = {"image": url, "createdTime": created[:10] if created else None}
    cache[ad_id] = info
    return info


# -------------------------------------------------------------- Shopify ---
def shop_get(path, **params):
    url = f"https://{SHOP}/admin/api/{SAPI}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": STOK})
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), r.headers.get("Link", "")
        except (urllib.error.URLError, TimeoutError):
            continue
    sys.exit("Shopify unreachable after retries")


ORDER_FIELDS = ("id,created_at,current_total_price,total_price,cancelled_at,"
                "financial_status,customer,line_items,source_name,shipping_address")

# Orders created from Shopify Draft Orders are manually-built wholesale/B2B
# invoices (staff-entered bulk restocks etc) — not retail traffic driven by
# ads. Mixing them into "Store Revenue" wrecks MER/ROAS for the client report.
WHOLESALE_SOURCE = "shopify_draft_order"


def is_wholesale(order):
    return order.get("source_name") == WHOLESALE_SOURCE


def orders_between(since_dt, until_dt, fields=ORDER_FIELDS):
    out, params = [], dict(status="any", limit=250,
                            created_at_min=since_dt.isoformat(), created_at_max=until_dt.isoformat(),
                            fields=fields)
    while True:
        data, link = shop_get("orders.json", **params)
        out.extend(data.get("orders", []))
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        if not m:
            return out
        nxt = urllib.parse.parse_qs(urllib.parse.urlparse(m.group(1)).query)
        params = {"limit": 250, "page_info": nxt["page_info"][0]}


def is_new_customer_order(o):
    """True iff this specific order is the one that created the customer
    record — Shopify stamps the customer's created_at within moments of
    their first checkout, so a close timestamp match is a first-order
    signal, not a range-dependent dedup."""
    c = o.get("customer") or {}
    if not c.get("id"):
        return False
    try:
        return abs((datetime.fromisoformat(c["created_at"]) -
                     datetime.fromisoformat(o["created_at"])).total_seconds()) < 120
    except Exception:
        return False


def compact_order(o):
    revenue = float(o.get("current_total_price") or o.get("total_price") or 0)
    total = float(o.get("total_price") or 0)
    addr = o.get("shipping_address") or {}
    items = []
    for li in (o.get("line_items") or []):
        title = clean_title(li.get("title"))
        if not title:
            continue
        qty = int(li.get("quantity") or 0)
        gross = float(li.get("price") or 0) * qty
        disc = sum(float(dd.get("amount") or 0) for dd in (li.get("discount_allocations") or []))
        items.append({"title": title, "type": li.get("product_type") or "",
                       "vendor": li.get("vendor") or "", "qty": qty, "revenue": round(gross - disc, 2)})
    return {
        "date": o["created_at"][:10],
        "revenue": round(revenue, 2),
        "totalPrice": round(total, 2),
        "province": clean_title(addr.get("province")) or clean_title(addr.get("city")) or "Unknown",
        "newCustomer": is_new_customer_order(o),
        "items": items,
    }


def all_active_products():
    out, params = [], dict(limit=250, status="active", fields="id,title,variants")
    while True:
        data, link = shop_get("products.json", **params)
        out.extend(data.get("products", []))
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        if not m:
            return out
        nxt = urllib.parse.parse_qs(urllib.parse.urlparse(m.group(1)).query)
        params = {"limit": 250, "page_info": nxt["page_info"][0]}


def stock_snapshot(threshold=LOW_STOCK_THRESHOLD):
    """Current stock per product (summed across variants), for tracked
    inventory only — variants Shopify isn't tracking quantity for are
    skipped rather than reported as a false zero."""
    out = []
    for p in all_active_products():
        variants = [v for v in (p.get("variants") or []) if v.get("inventory_management")]
        if not variants:
            continue
        stock = sum(int(v.get("inventory_quantity") or 0) for v in variants)
        out.append({"name": clean_title(p.get("title")) or "—", "stock": stock, "low": stock <= threshold})
    out.sort(key=lambda x: x["stock"])
    return out


# --------------------------------------------------------------- main -----
def inject(payload):
    src = open(DASHBOARD, encoding="utf-8").read()
    block = ("/* DASHBOARD_DATA \u2014 generated by mdesign_client_dashboard_data.py, do not hand-edit */\n"
              "const DATA=" + json.dumps(payload, ensure_ascii=False) + ";")
    pattern = r"/\* DASHBOARD_DATA[^\n]*\*/\nconst DATA=.*?;"
    if re.search(pattern, src, re.S):
        # repl must be a callable, not the raw string: re.sub treats backslashes
        # in a string repl as template escapes (\r, \n, \1...), which corrupts
        # JSON-escaped control characters (e.g. a product title with a literal
        # newline in it) baked in by json.dumps.
        src = re.sub(pattern, lambda _m: block, src, count=1, flags=re.S)
    else:
        sys.exit("Could not find DASHBOARD_DATA marker in " + DASHBOARD)
    open(DASHBOARD, "w", encoding="utf-8").write(src)


if __name__ == "__main__":
    now = datetime.now(CAIRO)
    today = now.date()
    lookback_start = today - timedelta(days=MAX_LOOKBACK_DAYS - 1)
    since_s, until_s = lookback_start.isoformat(), today.isoformat()
    print(f"Window: {since_s} \u2192 {until_s}  ({MAX_LOOKBACK_DAYS} days, daily granularity)\n")

    print("Meta: daily account series...")
    acct_rows = meta_insights(since_s, until_s, time_increment=1)
    meta_daily = {r["date_start"]: row_metrics(r) for r in acct_rows}

    print("Meta: daily campaign series...")
    camp_rows = meta_insights_chunked(lookback_start, today, level="campaign", time_increment=1, limit=500)
    campaign_daily = []
    for r in camp_rows:
        m = row_metrics(r)
        m["date"] = r["date_start"]
        m["name"] = r.get("campaign_name", "\u2014")
        campaign_daily.append(m)
    print(f"  {len(campaign_daily)} campaign-day rows")

    print("Meta: daily ad series...")
    ad_rows = meta_insights_chunked(lookback_start, today, chunk_days=14, level="ad", time_increment=1, limit=500)
    ad_daily = []
    ad_ids = set()
    for r in ad_rows:
        m = row_metrics(r)
        if m["spend"] <= 0:
            continue  # skip zero-spend rows, they're pure noise at this granularity
        m["date"] = r["date_start"]
        m["adId"] = r.get("ad_id")
        m["name"] = r.get("ad_name", "\u2014")
        m["campaign"] = r.get("campaign_name", "")
        ad_daily.append(m)
        ad_ids.add(m["adId"])
    print(f"  {len(ad_daily)} ad-day rows across {len(ad_ids)} ads")

    print("Meta: creative images + creation dates for every ad seen...")
    image_cache = {}
    ad_info = {aid: fetch_ad_info(aid, image_cache) for aid in ad_ids}
    ad_images = {aid: info["image"] for aid, info in ad_info.items()}
    ad_created = {aid: info["createdTime"] for aid, info in ad_info.items()}
    print(f"  {sum(1 for v in ad_images.values() if v)}/{len(ad_images)} ads have a preview image")

    print("Meta: daily age/gender breakdown...")
    aud_rows = meta_insights_chunked(lookback_start, today, breakdowns="age,gender", time_increment=1)
    audience_daily = []
    for r in aud_rows:
        purchases = action_val(r.get("actions"))
        if purchases <= 0 and float(r.get("spend") or 0) <= 0:
            continue
        audience_daily.append({
            "date": r["date_start"], "age": r.get("age") or "unknown", "gender": r.get("gender") or "unknown",
            "purchases": round(purchases), "purchaseValue": round(action_val(r.get("action_values")), 2),
            "spend": round(float(r.get("spend") or 0), 2),
        })
    print(f"  {len(audience_daily)} age/gender-day rows")

    print("Shopify: orders across full window...")
    pulled = orders_between(datetime.combine(lookback_start, datetime.min.time(), CAIRO),
                             datetime.combine(today, datetime.max.time(), CAIRO))
    live_pulled = [o for o in pulled if not o.get("cancelled_at")]
    retail = [compact_order(o) for o in live_pulled if not is_wholesale(o)]
    wholesale = [compact_order(o) for o in live_pulled if is_wholesale(o)]
    print(f"  {len(pulled)} orders pulled ({len(retail)} retail, {len(wholesale)} wholesale/draft-order, "
          f"{len(pulled) - len(live_pulled)} cancelled excluded)")

    print("Shopify: stock levels...")
    inventory = stock_snapshot()
    print(f"  {len(inventory)} tracked products ({sum(1 for r in inventory if r['low'])} low stock, "
          f"threshold {LOW_STOCK_THRESHOLD} units)")

    payload = {
        "syncedAt": now.isoformat(timespec="seconds"),
        "currency": "EGP",
        "minDate": since_s,
        "today": until_s,
        "defaultPreset": "30d",
        "presets": [
            {"key": "7d", "label": "Last 7 Days", "days": 7},
            {"key": "30d", "label": "Last 30 Days", "days": 30},
            {"key": "last_month", "label": "Last Month"},
            {"key": "3m", "label": "Last 3 Months", "days": 90},
        ],
        "metaDaily": meta_daily,
        "campaignDaily": campaign_daily,
        "adDaily": ad_daily,
        "adImages": ad_images,
        "adCreatedAt": ad_created,
        "audienceDaily": audience_daily,
        "orders": retail,
        "wholesaleOrders": wholesale,
        "inventory": inventory,
    }

    inject(payload)
    print(f"\nInjected into {DASHBOARD}")
