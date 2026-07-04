#!/usr/bin/env python3
"""REWE Discount Fetcher using CloakBrowser."""
import sys, json, time, re
from cloakbrowser import launch

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

def fetch_rewe_offers(store_url):
    browser = launch(headless=True)
    page = browser.new_page()
    try:
        page.goto(store_url, timeout=60000)
        time.sleep(12)
        store_info = page.evaluate("() => window.stationaryMarket || {}")
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
        products = []
        for p in raw:
            name = p.get("name","").strip()
            price = parse_price(p.get("price",""))
            if not is_valid(name, price): continue
            products.append({
                "productTitle": name, "brand": None, "price": price,
                "regularPrice": None, "currency": "EUR",
                "category": p.get("category",""), "description": p.get("description","")[:200],
                "label": p.get("label",""), "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        return {"store": {"id": str(store_info.get("id","")), "name": f"REWE Markt {store_info.get('street','')}",
                "city": store_info.get("city",""), "postcode": store_info.get("postcode",""),
                "address": store_info.get("street","")}, "products": products, "count": len(products),
                "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    finally:
        browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 rewe_fetcher.py <store_url>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(fetch_rewe_offers(sys.argv[1]), indent=2, ensure_ascii=False))
