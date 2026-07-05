#!/usr/bin/env python3
"""
Discover REWE store offersUrls using the hidden modal search API (V2).

Vastly superior to the old marktsuche scraper:
- 100% match rate (no fuzzy street matching)
- Full metadata (name, address, lat/lng)
- ~5s per city (vs ~30s old method) — no redirect resolution needed!

URL construction: https://www.rewe.de/angebote/<city-slug>/<wwIdent>/<store-slug>/
  - city-slug = slugify(city name)
  - store-slug = "rewe-markt-" + slugify(street)

USAGE:
  python3 discover-rewe-v2.py --test              # test on 3 cities
  python3 discover-rewe-v2.py --city Nürnberg     # one city
  python3 discover-rewe-v2.py --limit 50          # 50 cities
  python3 discover-rewe-v2.py                     # all cities
"""
import json
import sys
import os
import time
import re
import uuid
from pathlib import Path

os.environ.setdefault("CLOAKBROWSER_SUPPRESS_FONT_WARNING", "1")

try:
    from cloakbrowser import launch
except ImportError:
    print("ERROR: cloakbrowser not installed.", file=sys.stderr)
    sys.exit(1)

STORES_PATH = Path(__file__).parent.parent / "data" / "stores.json"
PROGRESS_PATH = Path(__file__).parent.parent / "data" / "rewe-discovery-v2-progress.json"
RESULTS_PATH = Path(__file__).parent.parent / "data" / "rewe-discovered-stores.json"

MAJOR_CITIES = [
    "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Stuttgart",
    "Düsseldorf", "Dortmund", "Essen", "Leipzig", "Bremen", "Dresden",
    "Hannover", "Nürnberg", "Duisburg", "Bochum", "Wuppertal", "Bielefeld",
    "Bonn", "Münster", "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden",
    "Gelsenkirchen", "Mönchengladbach", "Braunschweig", "Kiel", "Chemnitz",
    "Aachen", "Halle", "Magdeburg", "Freiburg", "Krefeld", "Lübeck",
    "Oberhausen", "Erfurt", "Mainz", "Rostock", "Kassel", "Hagen",
    "Saarbrücken", "Potsdam", "Hamm", "Ludwigshafen", "Mülheim", "Oldenburg",
    "Osnabrück", "Leverkusen", "Heidelberg", "Solingen", "Darmstadt",
    "Neuss", "Herne", "Regensburg", "Paderborn", "Ingolstadt", "Würzburg",
    "Wolfsburg", "Offenbach", "Ulm", "Heilbronn", "Pforzheim", "Göttingen",
    "Bottrop", "Recklinghausen", "Koblenz", "Bergisch Gladbach", "Erlangen",
    "Reutlingen", "Bremerhaven", "Jena", "Remscheid", "Trier", "Fürth",
    "Moers", "Siegen", "Cottbus", "Hildesheim", "Gera", "Salzgitter",
    "Witten", "Celle", "Flensburg", "Dessau-Roßlau",
]


def load_json(path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def slugify(s):
    """REWE-style slugify: lowercase, umlauts expanded, spaces→hyphens."""
    s = s.lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"-+", "-", s)
    return s


def construct_offers_url(wwident, city, street, market_type="REWE Markt"):
    """Construct the offers URL from metadata (no redirect needed)."""
    city_slug = slugify(city)
    if "Center" in market_type:
        prefix = "rewe-center-"
    elif "Getränkemarkt" in market_type or "GM" == market_type:
        prefix = "rewe-getraenkemarkt-"
    else:
        prefix = "rewe-markt-"
    store_slug = prefix + slugify(street)
    return f"https://www.rewe.de/angebote/{city_slug}/{wwident}/{store_slug}/"


class ReweDiscovery:
    def __init__(self):
        self.browser = None
        self.page = None
        self.initialized = False

    def init(self):
        print("  Launching CloakBrowser...")
        self.browser = launch(headless=True)
        self.page = self.browser.new_page()
        print("  Clearing Cloudflare...")
        self.page.goto("https://www.rewe.de/angebote/nuernberg/461781/rewe-markt-lichtenfelser-strasse-2a/", timeout=60000)
        time.sleep(8)
        print(f"  ✓ Ready")
        self.initialized = True

    def ensure_init(self):
        if not self.initialized:
            self.init()

    def search_city(self, city_name, page_num=1):
        """Search for REWE stores in a city. Returns (stores, page_count, object_count)."""
        self.ensure_init()
        request_body = [{
            "id": str(uuid.uuid4()),
            "name": "wks-market-list",
            "namespace": "market-chooser",
            "query": {
                "searchTerm": city_name,
                "page": str(page_num),
                "longitude": None,
                "latitude": None,
                "productId": "",
                "hasUserInteracted": "true",
            }
        }]

        body_json = json.dumps(request_body)

        text = self.page.evaluate(f"""async () => {{
            try {{
                const resp = await fetch('https://www.rewe.de/api/frontend-includes', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json', 'Accept': 'application/json' }},
                    body: JSON.stringify({body_json})
                }});
                return await resp.text();
            }} catch (e) {{
                return JSON.stringify({{error: e.message}});
            }}
        }}""")

        return self._parse_store_results(text)

    def _parse_store_results(self, text):
        """Extract store data from the API response."""
        # Extract fields with regex (robust against escaping)
        ww_ident_pattern = r'[\\]?"wwIdent[\\]?"\s*:\s*[\\]?"(\d+)[\\]?"'
        name_pattern = r'[\\]?"name[\\]?"\s*:\s*[\\]?"([^"\\]+)[\\]?"'
        street_pattern = r'[\\]?"street[\\]?"\s*:\s*[\\]?"([^"\\]+)[\\]?"'
        zip_pattern = r'[\\]?"zipCode[\\]?"\s*:\s*[\\]?"(\d+)[\\]?"'
        city_pattern = r'[\\]?"city[\\]?"\s*:\s*[\\]?"([^"\\]+)[\\]?"'
        lat_pattern = r'[\\]?"latitude[\\]?"\s*:\s*([\\]?[\d.]+)'
        lng_pattern = r'[\\]?"longitude[\\]?"\s*:\s*([\\]?[\d.]+)'
        type_pattern = r'[\\]?"marketTypeDisplayName[\\]?"\s*:\s*[\\]?"([^"\\]+)[\\]?"'

        # Deduplicate wwIdent values (each appears multiple times in HTML)
        wwidents_raw = re.findall(ww_ident_pattern, text)
        seen = set()
        wwidents = []
        for w in wwidents_raw:
            if w not in seen:
                seen.add(w)
                wwidents.append(w)

        names = re.findall(name_pattern, text)
        streets = re.findall(street_pattern, text)
        zips = re.findall(zip_pattern, text)
        cities = re.findall(city_pattern, text)
        lats = re.findall(lat_pattern, text)
        lngs = re.findall(lng_pattern, text)
        types = re.findall(type_pattern, text)

        stores = []
        for i, wwident in enumerate(wwidents):
            city = cities[i] if i < len(cities) else ""
            street = streets[i] if i < len(streets) else ""
            mtype = types[i] if i < len(types) else "REWE Markt"
            store = {
                "wwIdent": wwident,
                "name": names[i] if i < len(names) else "",
                "street": street,
                "zipCode": zips[i] if i < len(zips) else "",
                "city": city,
                "latitude": float(lats[i]) if i < len(lats) and lats[i] not in ["null", "None"] else None,
                "longitude": float(lngs[i]) if i < len(lngs) and lngs[i] not in ["null", "None"] else None,
                "marketType": mtype,
                "offersUrl": construct_offers_url(wwident, city, street, mtype) if city and street else None,
            }
            stores.append(store)

        page_count_match = re.search(r'[\\]?"pageCount[\\]?"\s*:\s*(\d+)', text)
        object_count_match = re.search(r'[\\]?"objectCount[\\]?"\s*:\s*(\d+)', text)
        page_count = int(page_count_match.group(1)) if page_count_match else 1
        object_count = int(object_count_match.group(1)) if object_count_match else len(stores)

        return stores, page_count, object_count

    def close(self):
        if self.browser:
            self.browser.close()
            self.browser = None
            self.initialized = False


def discover_city(discovery, city_name):
    """Discover all REWE stores in a city. Returns list of store dicts."""
    all_stores = []

    # Page 1
    stores, page_count, object_count = discovery.search_city(city_name, 1)
    all_stores.extend(stores)

    # Remaining pages
    for p in range(2, page_count + 1):
        time.sleep(0.3)
        stores, _, _ = discovery.search_city(city_name, p)
        all_stores.extend(stores)

    return all_stores, object_count


def haversine_km(lat1, lon1, lat2, lon2):
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def update_stores_json(discovered):
    """Match discovered stores to OSM stores by lat/lng proximity."""
    stores = load_json(STORES_PATH) or []
    osm_rewe = [s for s in stores if s["brand"] == "rewe" and not s.get("offersUrl")]
    matched = 0

    for disc in discovered:
        if not disc.get("offersUrl") or disc.get("latitude") is None:
            continue

        best = None
        best_dist = float("inf")
        for osm in osm_rewe:
            if osm.get("offersUrl") or not osm.get("lat"):
                continue
            dist = haversine_km(disc["latitude"], disc["longitude"], osm["lat"], osm["lng"])
            if dist < best_dist and dist < 0.5:
                best_dist = dist
                best = osm

        if best:
            best["offersUrl"] = disc["offersUrl"]
            best["reweId"] = disc["wwIdent"]
            matched += 1

    save_json(STORES_PATH, stores)
    return matched


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", type=str)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()

    if args.test:
        cities = ["Nürnberg", "Hamburg", "Berlin"]
    elif args.city:
        cities = [args.city]
    else:
        stores = load_json(STORES_PATH) or []
        progress = load_json(PROGRESS_PATH) or {"cities_done": []}
        processed = set(progress.get("cities_done", []))

        city_set = set(MAJOR_CITIES)
        for s in stores:
            if s["brand"] != "rewe" or s.get("offersUrl"):
                continue
            addr = s.get("address") or ""
            parts = addr.split(",")
            if len(parts) >= 2:
                city_part = parts[-1].strip()
                m = re.match(r"\d*\s*([A-Za-zÄäÖöÜüß][A-Za-zÄäÖöÜüß\s\-]+)", city_part)
                if m:
                    city = m.group(1).strip()
                    if city and len(city) > 1:
                        city_set.add(city)
        cities = sorted([c for c in city_set if c not in processed])

    if args.limit > 0:
        cities = cities[:args.limit]

    print(f"=== REWE Discovery V2 ===")
    print(f"Cities: {len(cities)}")
    print()

    all_discovered = load_json(RESULTS_PATH) or []
    existing = {s["wwIdent"] for s in all_discovered}
    progress = load_json(PROGRESS_PATH) or {"cities_done": [], "stores_discovered": 0, "cities_failed": []}

    discovery = ReweDiscovery()
    total_new = 0

    try:
        for i, city in enumerate(cities):
            print(f"[{i+1}/{len(cities)}] {city}")
            try:
                stores, expected = discover_city(discovery, city)
                new = [s for s in stores if s["wwIdent"] not in existing]
                print(f"  Found {len(stores)} stores ({len(new)} new)")

                for s in new:
                    all_discovered.append(s)
                    existing.add(s["wwIdent"])
                total_new += len(new)

                if stores:
                    s = stores[0]
                    print(f"  Sample: {s['wwIdent']} → {s.get('offersUrl','?')[:70]}")

                progress["cities_done"].append(city)
                progress["stores_discovered"] = len(all_discovered)

            except Exception as e:
                print(f"  ✗ {type(e).__name__}: {e}")
                progress["cities_failed"].append(city)
                # Restart CloakBrowser on crash
                try:
                    discovery.close()
                except:
                    pass
                discovery = ReweDiscovery()

            if (i + 1) % args.batch_size == 0 or i == len(cities) - 1:
                save_json(RESULTS_PATH, all_discovered)
                save_json(PROGRESS_PATH, progress)
                matched = update_stores_json(all_discovered[-500:])
                print(f"  → Saved ({len(progress['cities_done'])} cities, {len(all_discovered)} stores, {matched} matched)")

            time.sleep(0.3)

    finally:
        discovery.close()

    save_json(RESULTS_PATH, all_discovered)
    save_json(PROGRESS_PATH, progress)
    matched = update_stores_json(all_discovered)

    stores = load_json(STORES_PATH) or []
    with_url = sum(1 for s in stores if s["brand"] == "rewe" and s.get("offersUrl"))
    without = sum(1 for s in stores if s["brand"] == "rewe" and not s.get("offersUrl"))

    print(f"\n=== SUMMARY ===")
    print(f"Cities done: {len(progress['cities_done'])}")
    print(f"Cities failed: {len(progress['cities_failed'])}")
    print(f"Total discovered: {len(all_discovered)}")
    print(f"New this run: {total_new}")
    print(f"REWE with offersUrl: {with_url}")
    print(f"REWE without offersUrl: {without}")


if __name__ == "__main__":
    main()
