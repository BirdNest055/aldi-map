#!/usr/bin/env python3
"""
Discover REWE offersUrl by scraping city-specific marktsuche pages.

Strategy:
1. Group OSM REWE stores by city (from addr:city tag)
2. For each city, visit https://www.rewe.de/marktsuche/<city-slug>/
3. Extract all store offers URLs from the page
4. Match by street name (from store slug) to OSM stores
5. Save discovered offersUrls back to stores.json

This is much faster than per-store CloakBrowser visits:
- 1 CloakBrowser visit per city (not per store)
- Typical city has 5-20 REWE stores
- ~500 cities in Germany = ~500 visits total

Usage:
  python3 discover-rewe-offers-urls.py [--limit-cities N] [--city NAME]
"""
import json
import sys
import time
import re
import os
from pathlib import Path
from collections import defaultdict

try:
    from cloakbrowser import launch
except ImportError:
    print("ERROR: cloakbrowser not installed. Run: pip install cloakbrowser", file=sys.stderr)
    sys.exit(1)

STORES_PATH = Path(__file__).parent.parent / "data" / "stores.json"
PROGRESS_PATH = Path(__file__).parent.parent / "data" / "rewe-discovery-progress.json"


def load_stores():
    return json.loads(STORES_PATH.read_text(encoding="utf-8"))


def save_stores(stores):
    STORES_PATH.write_text(json.dumps(stores, indent=2, ensure_ascii=False), encoding="utf-8")


def load_progress():
    if PROGRESS_PATH.exists():
        return json.loads(PROGRESS_PATH.read_text())
    return {"cities_processed": [], "stores_discovered": 0, "stores_failed": 0}


def save_progress(progress):
    PROGRESS_PATH.write_text(json.dumps(progress, indent=2))


def slugify_city(name):
    """Convert city name to URL slug: 'München' → 'muenchen', 'Frankfurt am Main' → 'frankfurt-am-main'"""
    if not name:
        return None
    # German umlaut replacements
    slug = name.lower()
    slug = slug.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    # Remove non-alphanumeric (keep spaces and hyphens)
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    # Replace spaces with hyphens
    slug = re.sub(r"\s+", "-", slug.strip())
    return slug


def extract_store_slug_info(slug):
    """Parse store slug like 'rewe-markt-karl-zucker-str-10' → street='Karl-Zucker-Str. 10'"""
    # Remove 'rewe-markt-' prefix
    parts = slug.replace("rewe-markt-", "").split("-")
    # Last part is usually the house number
    if len(parts) > 1 and parts[-1].isdigit():
        house = parts[-1]
        street_parts = parts[:-1]
        # Abbreviations
        street = "-".join(street_parts)
        # Common abbreviations: str → Str.
        street = re.sub(r"-str$", " Str.", street)
        return f"{street} {house}"
    return slug.replace("-", " ")


def get_stores_for_city(city_slug):
    """Visit the marktsuche page for a city, extract store offers URLs."""
    browser = launch(headless=True)
    page = browser.new_page()
    try:
        url = f"https://www.rewe.de/marktsuche/{city_slug}/"
        # Shorter timeout — if page doesn't load in 30s, skip this city
        page.goto(url, timeout=30000)
        time.sleep(10)  # shorter wait

        # Check if page loaded correctly (not 404)
        title = page.title()
        if "404" in title:
            return []

        # Extract store data from links
        stores = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('a[href*="/angebote/"]'));
            const seen = new Set();
            const results = [];
            for (const a of links) {
                const href = a.href;
                const match = href.match(/\\/angebote\\/([^/]+)\\/(\\d+)\\/([^/]+)\\/?/);
                if (match && !seen.has(match[2])) {
                    seen.add(match[2]);
                    results.push({
                        reweId: match[2],
                        offersUrl: href,
                        citySlug: match[1],
                        storeSlug: match[3],
                        linkText: a.innerText.trim().substring(0, 200),
                    });
                }
            }
            return results;
        }""")
        return stores
    finally:
        browser.close()


def match_store_to_osm(rewe_store, osm_stores_in_city):
    """
    Match a REWE store (from marktsuche) to an OSM store by street name.
    Returns the best-matching OSM store ID or None.
    """
    rewe_street = extract_store_slug_info(rewe_store["storeSlug"]).lower()
    
    best_match = None
    best_score = 0
    
    for osm_store in osm_stores_in_city:
        osm_address = (osm_store.get("address") or "").lower()
        # Simple matching: count common words
        rewe_words = set(re.split(r"[\s,-]+", rewe_street))
        osm_words = set(re.split(r"[\s,-]+", osm_address))
        common = rewe_words & osm_words - {"rewe", "markt", "str", "str."}
        score = len(common)
        if score > best_score:
            best_score = score
            best_match = osm_store
    
    return best_match if best_score >= 2 else None  # require at least 2 common words


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-cities", type=int, default=0, help="Max cities to process (0 = all)")
    parser.add_argument("--city", type=str, help="Process only this city")
    parser.add_argument("--batch-size", type=int, default=10, help="Save after every N cities")
    args = parser.parse_args()

    os.environ.setdefault("CLOAKBROWSER_SUPPRESS_FONT_WARNING", "1")

    stores = load_stores()
    progress = load_progress()

    # Group REWE stores without offersUrl by city
    rewe_without_url = [s for s in stores if s["brand"] == "rewe" and not s.get("offersUrl")]
    print(f"Total REWE stores: {sum(1 for s in stores if s['brand'] == 'rewe')}")
    print(f"REWE stores without offersUrl: {len(rewe_without_url)}")

    # Extract city from address
    city_groups = defaultdict(list)
    for s in rewe_without_url:
        addr = s.get("address") or ""
        # Try to extract city from address (last part after comma)
        parts = addr.split(",")
        if len(parts) >= 2:
            city_part = parts[-1].strip()
            # Extract city name (must start with a letter, not a number)
            city_match = re.match(r"\d*\s*([A-Za-zÄäÖöÜüß][A-Za-zÄäÖöÜüß\s\-]+)", city_part)
            if city_match:
                city = city_match.group(1).strip()
                if city and len(city) > 1:
                    city_groups[city].append(s)

    print(f"Cities with REWE stores needing URLs: {len(city_groups)}")
    print(f"Already processed cities: {len(progress['cities_processed'])}")

    # Filter to unprocessed cities
    cities_to_process = [
        (city, stores) for city, stores in city_groups.items()
        if city not in progress["cities_processed"]
        and (not args.city or city.lower() == args.city.lower())
    ]
    if args.limit_cities > 0:
        cities_to_process = cities_to_process[:args.limit_cities]

    print(f"To process this run: {len(cities_to_process)} cities")
    print()

    total_discovered = 0
    total_failed = 0

    for i, (city, osm_stores) in enumerate(cities_to_process):
        city_slug = slugify_city(city)
        print(f"[{i+1}/{len(cities_to_process)}] {city} → /marktsuche/{city_slug}/ ({len(osm_stores)} OSM stores)")

        try:
            rewe_stores = get_stores_for_city(city_slug)
            print(f"  Found {len(rewe_stores)} REWE stores on page")

            matched = 0
            for rewe_store in rewe_stores:
                osm_match = match_store_to_osm(rewe_store, osm_stores)
                if osm_match:
                    osm_match["offersUrl"] = rewe_store["offersUrl"]
                    osm_match["reweId"] = rewe_store["reweId"]
                    matched += 1
                    total_discovered += 1
                    progress["stores_discovered"] += 1

            print(f"  Matched: {matched}/{len(rewe_stores)}")
            total_failed += len(osm_stores) - matched
            progress["stores_failed"] += len(osm_stores) - matched

        except Exception as e:
            print(f"  ✗ Error: {type(e).__name__}: {e}")
            total_failed += len(osm_stores)
            progress["stores_failed"] += len(osm_stores)

        progress["cities_processed"].append(city)

        if (i + 1) % args.batch_size == 0 or i == len(cities_to_process) - 1:
            save_stores(stores)
            save_progress(progress)
            print(f"  → Saved ({len(progress['cities_processed'])} cities, {progress['stores_discovered']} discovered)")

        time.sleep(3)

    save_stores(stores)
    save_progress(progress)

    print(f"\n=== SUMMARY ===")
    print(f"Cities processed this run: {len(cities_to_process)}")
    print(f"Stores discovered: {total_discovered}")
    print(f"Stores failed: {total_failed}")
    print(f"Total cities processed: {len(progress['cities_processed'])}")
    print(f"Total discovered: {progress['stores_discovered']}")
    print(f"Total failed: {progress['stores_failed']}")

    stores = load_stores()
    remaining = sum(1 for s in stores if s["brand"] == "rewe" and not s.get("offersUrl"))
    with_url = sum(1 for s in stores if s["brand"] == "rewe" and s.get("offersUrl"))
    print(f"\nREWE stores with offersUrl: {with_url}")
    print(f"REWE stores without offersUrl: {remaining}")


if __name__ == "__main__":
    main()
