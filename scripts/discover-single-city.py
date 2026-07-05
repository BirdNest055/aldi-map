#!/usr/bin/env python3
"""
Run REWE discovery for a single city. Used by the batch runner.
Usage: python3 discover-single-city.py <city_name>
"""
import sys
import os
import json
import time
import re
from pathlib import Path
from collections import defaultdict

os.environ.setdefault("CLOAKBROWSER_SUPPRESS_FONT_WARNING", "1")

# Add scripts dir to path
sys.path.insert(0, str(Path(__file__).parent))

# Import functions from the main script
import importlib.util
spec = importlib.util.spec_from_file_location("disc", Path(__file__).parent / "discover-rewe-offers-urls.py")
disc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(disc)

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 discover-single-city.py <city_name>")
        sys.exit(1)
    
    city = sys.argv[1]
    city_slug = disc.slugify_city(city)
    
    # Load stores
    stores = disc.load_stores()
    
    # Find OSM stores in this city
    osm_stores_in_city = []
    for s in stores:
        if s["brand"] != "rewe" or s.get("offersUrl"):
            continue
        addr = s.get("address") or ""
        parts = addr.split(",")
        if len(parts) >= 2:
            city_part = parts[-1].strip()
            city_match = re.match(r"\d*\s*([A-Za-zÄäÖöÜüß][A-Za-zÄäÖöÜüß\s\-]+)", city_part)
            if city_match and city_match.group(1).strip() == city:
                osm_stores_in_city.append(s)
    
    if not osm_stores_in_city:
        print(f"No OSM stores found for city: {city}")
        sys.exit(0)
    
    print(f"City: {city} → /marktsuche/{city_slug}/ ({len(osm_stores_in_city)} OSM stores)")
    
    try:
        rewe_stores = disc.get_stores_for_city(city_slug)
        print(f"  Found {len(rewe_stores)} REWE stores on page")
        
        matched = 0
        for rs in rewe_stores:
            m = disc.match_store_to_osm(rs, osm_stores_in_city)
            if m:
                m["offersUrl"] = rs["offersUrl"]
                m["reweId"] = rs["reweId"]
                matched += 1
                print(f"  ✓ {m['id']}: {rs['offersUrl']}")
        
        print(f"  Matched: {matched}/{len(rewe_stores)}")
        
        # Save stores
        disc.save_stores(stores)
        
        # Update progress
        progress = disc.load_progress()
        if city not in progress["cities_processed"]:
            progress["cities_processed"].append(city)
            progress["stores_discovered"] += matched
            progress["stores_failed"] += len(osm_stores_in_city) - matched
            disc.save_progress(progress)
        
        print(f"  Saved. Total: {len(progress['cities_processed'])} cities, {progress['stores_discovered']} discovered")
        
    except Exception as e:
        print(f"  ✗ Error: {type(e).__name__}: {e}")
        # Still mark as processed so we don't retry
        progress = disc.load_progress()
        if city not in progress["cities_processed"]:
            progress["cities_processed"].append(city)
            progress["stores_failed"] += len(osm_stores_in_city)
            disc.save_progress(progress)
        sys.exit(1)

if __name__ == "__main__":
    main()
