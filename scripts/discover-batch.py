#!/usr/bin/env python3
"""
Batch runner: runs discover-single-city.py for each unprocessed city.
Each city runs in a separate subprocess so a crash doesn't kill the batch.
"""
import sys
import os
import json
import re
import subprocess
import time
from pathlib import Path
from collections import defaultdict

STORES_PATH = Path(__file__).parent.parent / "data" / "stores.json"
PROGRESS_PATH = Path(__file__).parent.parent / "data" / "rewe-discovery-progress.json"
SINGLE_SCRIPT = Path(__file__).parent / "discover-single-city.py"


def main():
    stores = json.loads(STORES_PATH.read_text(encoding="utf-8"))
    progress = json.loads(PROGRESS_PATH.read_text()) if PROGRESS_PATH.exists() else {
        "cities_processed": [], "stores_discovered": 0, "stores_failed": 0
    }
    
    # Group REWE stores without offersUrl by city
    rewe_without_url = [s for s in stores if s["brand"] == "rewe" and not s.get("offersUrl")]
    city_groups = defaultdict(list)
    for s in rewe_without_url:
        addr = s.get("address") or ""
        parts = addr.split(",")
        if len(parts) >= 2:
            city_part = parts[-1].strip()
            city_match = re.match(r"\d*\s*([A-Za-zÄäÖöÜüß][A-Za-zÄäÖöÜüß\s\-]+)", city_part)
            if city_match:
                city = city_match.group(1).strip()
                if city and len(city) > 1 and city not in progress["cities_processed"]:
                    city_groups[city].append(s)
    
    cities = sorted(city_groups.keys())
    print(f"Cities to process: {len(cities)}")
    print(f"Already processed: {len(progress['cities_processed'])}")
    print()
    
    for i, city in enumerate(cities):
        print(f"[{i+1}/{len(cities)}] {city} ({len(city_groups[city])} stores)")
        try:
            result = subprocess.run(
                [sys.executable, str(SINGLE_SCRIPT), city],
                timeout=90,  # 90s per city
                capture_output=False,
                env={**os.environ, "CLOAKBROWSER_SUPPRESS_FONT_WARNING": "1"},
            )
            if result.returncode != 0:
                print(f"  (exit code {result.returncode})")
        except subprocess.TimeoutExpired:
            print(f"  ✗ Timeout (90s) — skipping")
        except Exception as e:
            print(f"  ✗ Error: {e}")
        
        # Brief pause between cities
        time.sleep(1)
    
    # Final summary
    progress = json.loads(PROGRESS_PATH.read_text())
    stores = json.loads(STORES_PATH.read_text(encoding="utf-8"))
    with_url = sum(1 for s in stores if s["brand"] == "rewe" and s.get("offersUrl"))
    without = sum(1 for s in stores if s["brand"] == "rewe" and not s.get("offersUrl"))
    print(f"\n=== FINAL ===")
    print(f"Cities processed: {len(progress['cities_processed'])}")
    print(f"REWE with offersUrl: {with_url}")
    print(f"REWE without offersUrl: {without}")


if __name__ == "__main__":
    main()
