#!/usr/bin/env python3
"""REWE Discount Fetcher using CloakBrowser.

Error handling: wraps all operations in try/except with typed error categories
that get surfaced to the GitHub Actions workflow via exit codes + structured
stderr output.

EXIT CODES
----------
  0  success
 10  network error (CloakBrowser couldn't reach rewe.de)
 20  parse error (page structure changed — selectors need updating)
 30  storage error (couldn't write to /tmp/rewe-result.json)
 50  unknown error
"""
import sys, json, time, re, os, traceback
from cloakbrowser import launch

# ---------------------------------------------------------------------------
# Error helpers
# ---------------------------------------------------------------------------

class FetchError(Exception):
    """Base error with category + exit_code."""
    def __init__(self, message, *, category="unknown", exit_code=50, stage="unknown", cause=None):
        super().__init__(message)
        self.message = message
        self.category = category
        self.exit_code = exit_code
        self.stage = stage
        self.cause = cause

    def signature(self):
        msg_head = (self.message or "")[:120].lower().strip()
        import hashlib
        return hashlib.sha1(f"{self.category}|{self.stage}|{msg_head}".encode()).hexdigest()[:16]


def emit_error(err):
    """Emit a structured error line + traceback to stderr."""
    print(f"error|{err.category}|{err.stage}|{err.signature()}", file=sys.stderr, flush=True)
    print(f"ERROR [{err.category}@{err.stage}]: {err.message}", file=sys.stderr, flush=True)
    if err.cause:
        print(f"CAUSE: {type(err.cause).__name__}: {err.cause}", file=sys.stderr, flush=True)
    print("TRACEBACK:", file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)


# --------------------------------------------------------------------------- #
# Fetcher
# --------------------------------------------------------------------------- #

CATEGORIES = [
    "Obst und Gemüse", "An der Bedientheke", "Kühlung", "Schnell und einfach",
    "Tiefkühl", "Frühstück", "Kochen und Backen", "Süßes und Salziges",
    "Alkoholfreie Getränke", "Bier", "Wein und Spirituosen",
    "Haushalt", "Drogerie", "Tier", "Freizeit und Mode",
]

def parse_price(s):
    if not s: return None
    try: return float(s.replace("€","").replace(",",".").strip())
    except: return None

def is_valid(name, price):
    if not name or price is None: return False
    if re.match(r"^\d+,\d+\s*€?$", name.strip()): return False
    return len(name.strip()) >= 3

# ---------------------------------------------------------------------------
# Size / quantity extraction
# ---------------------------------------------------------------------------
# Extracts size/weight/volume info from a text string (typically the product
# description line on the REWE flyer page) and returns a clean display string
# like "4x150 g", "1 L", "500 g", "10 Stk". Returns None if no pattern found.
#
# Patterns supported (German supermarket conventions):
#   "4 x 150 g"  →  "4x150 g"
#   "1,5 l"      →  "1,5 L"
#   "500g"       →  "500 g"
#   "1 kg"       →  "1 kg"
#   "10 Stück"   →  "10 Stk"
#   "6er Pack"   →  "6er Pack"

_MULTI_RE = re.compile(r'(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(l|liter|ml|g|kg|gramm)\b', re.I)
_SINGLE_RE = re.compile(r'(\d+(?:[,.]\d+)?)\s*(l|liter|ml|g|kg|gramm)\b', re.I)
_COUNT_RE = re.compile(r'(\d+)\s*(stk|stück|stueck|st)\b', re.I)
_PACK_RE = re.compile(r'(\d+)er\s*(pack|packung|pck|tabletten|kapseln|beutel|tüten|rolls?|rolle)\b', re.I)

def extract_size(text):
    """Find the first size/quantity pattern in text. Returns display string or None."""
    if not text:
        return None

    # Try multipack first (most specific): "6 x 1,5 l"
    m = _MULTI_RE.search(text)
    if m:
        count, each, unit = m.group(1), m.group(2), m.group(3).lower()
        unit_norm = "L" if unit in ("l", "liter") else unit
        return f"{count}x{each} {unit_norm}"

    # Single quantity: "500g", "1L", "0,5 l"
    m = _SINGLE_RE.search(text)
    if m:
        value, unit = m.group(1), m.group(2).lower()
        unit_norm = "L" if unit in ("l", "liter") else unit
        return f"{value} {unit_norm}"

    # Count: "10 Stück", "6 Stk"
    m = _COUNT_RE.search(text)
    if m:
        return f"{m.group(1)} Stk"

    # Pack: "6er Packung", "10er Pack"
    m = _PACK_RE.search(text)
    if m:
        return m.group(0).strip()

    return None


def enrich_title_with_size(name, description):
    """Append size info from description to the product name if not already present.

    Example:
      name="Ehrmann Almighurt", description="4x150g verschiedene Sorten"
      → "Ehrmann Almighurt 4x150 g"
    """
    if not name:
        return name

    # First check if size is already in the name
    size_in_name = extract_size(name)
    if size_in_name:
        return name  # Size already in title, don't duplicate

    # Try to extract from description
    if description:
        size = extract_size(description)
        if size:
            return f"{name} {size}"

    return name


def fetch_rewe_offers(store_url):
    """Fetch all offers from a REWE store page. Raises FetchError on failure."""
    try:
        browser = launch(headless=True)
    except Exception as e:
        raise FetchError(
            f"Could not launch CloakBrowser: {type(e).__name__}: {e}",
            category="network", exit_code=10, stage="browser-launch", cause=e,
        ) from e

    try:
        page = browser.new_page()
        try:
            page.goto(store_url, timeout=60000)
        except Exception as e:
            raise FetchError(
                f"Could not navigate to REWE store page: {type(e).__name__}: {e}",
                category="network", exit_code=10, stage="page-goto", cause=e,
            ) from e

        # Wait for page to render
        time.sleep(12)

        try:
            store_info = page.evaluate("() => window.stationaryMarket || {}")
        except Exception as e:
            raise FetchError(
                f"Could not extract store info (window.stationaryMarket): {e}",
                category="parse", exit_code=20, stage="extract-store-info", cause=e,
            ) from e

        if not store_info or not store_info.get("id"):
            # Page didn't load the expected data — likely Cloudflare blocked us
            raise FetchError(
                "store_info is empty — Cloudflare may have blocked the request, "
                "or REWE changed their page structure",
                category="parse", exit_code=20, stage="extract-store-info",
            )

        try:
            raw = page.evaluate("""async () => {
                const products = []; const seen = new Set();
                const cats = """ + json.dumps(CATEGORIES) + """;
                function extract(cat) {
                    document.querySelectorAll('article').forEach(a => {
                        const text = a.innerText.trim();
                        if (text && text.length > 10 && !seen.has(text)) {
                            seen.add(text);
                            const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
                            let name='', price='', desc='', label='';
                            if (lines.length > 0) name = lines[0];
                            for (const line of lines) { if (/^\\d+,\\d+\\s*$/.test(line.replace('€','').trim())) { price = line; break; } }
                            const lm = lines.find(l => ['Aktion','Knaller','Bonus','Neu'].includes(l));
                            if (lm) label = lm;
                            const dl = lines.slice(1).filter(l => !/^\\d+,\\d+\\s*$/.test(l.replace('€','').trim()) && !['Aktion','Knaller','Bonus','Neu'].includes(l));
                            desc = dl.join(' ');
                            if (name && price) products.push({name, price, description: desc, label, category: cat});
                        }
                    });
                }
                extract('Top-Angebote');
                for (const c of cats) {
                    const els = document.querySelectorAll('a, button, [role="tab"], div, span');
                    for (const el of els) { if (el.innerText && el.innerText.trim() === c) { el.click(); break; } }
                    await new Promise(r => setTimeout(r, 2000));
                    extract(c);
                }
                return products;
            }""")
        except Exception as e:
            raise FetchError(
                f"Could not extract products via JS evaluation: {type(e).__name__}: {e}",
                category="parse", exit_code=20, stage="extract-products", cause=e,
            ) from e

        if not raw:
            raise FetchError(
                "No products extracted — REWE page structure may have changed",
                category="parse", exit_code=20, stage="extract-products",
            )

        products = []
        for p in raw:
            name = p.get("name","").strip()
            price = parse_price(p.get("price",""))
            if not is_valid(name, price): continue
            # Enrich the title with size/weight info extracted from the description.
            # The description often contains text like "4x150g", "1L", "500 g" etc.
            # which is critical for users to compare products meaningfully.
            desc = p.get("description","")[:200]
            enriched_name = enrich_title_with_size(name, desc)
            products.append({
                "productTitle": enriched_name, "brand": None, "price": price,
                "regularPrice": None, "currency": "EUR",
                "category": p.get("category",""), "description": desc,
                "label": p.get("label",""), "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

        if not products:
            raise FetchError(
                f"All {len(raw)} raw products failed validation — price parser may be broken",
                category="parse", exit_code=20, stage="validate-products",
            )

        return {
            "store": {
                "id": str(store_info.get("id","")),
                "name": f"REWE Markt {store_info.get('street','')}",
                "city": store_info.get("city",""),
                "postcode": store_info.get("postcode",""),
                "address": store_info.get("street",""),
            },
            "products": products,
            "count": len(products),
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    finally:
        try:
            browser.close()
        except Exception:
            pass


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 rewe_fetcher.py <store_url>", file=sys.stderr)
        sys.exit(40)  # config error

    try:
        result = fetch_rewe_offers(sys.argv[1])
        try:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as e:
            err = FetchError(
                f"Could not serialize result to JSON: {e}",
                category="storage", exit_code=30, stage="serialize", cause=e,
            )
            emit_error(err)
            sys.exit(err.exit_code)
    except FetchError as e:
        emit_error(e)
        sys.exit(e.exit_code)
    except Exception as e:
        err = FetchError(
            f"Unexpected error: {type(e).__name__}: {e}",
            category="unknown", exit_code=50, stage="main", cause=e,
        )
        emit_error(err)
        sys.exit(err.exit_code)
