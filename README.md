# Discount Map

> **v1.1.0** — Interactive map of German supermarkets with discount fetching.

[![Vercel](https://img.shields.io/badge/deployed%20on-Vercel-black)](https://aldi-map-birdnest055s-projects.vercel.app)
[![Version](https://img.shields.io/badge/version-1.1.0-blue)](#)

**Live:** https://aldi-map-birdnest055s-projects.vercel.app

## What it does

Shows supermarkets on an interactive map of Germany. Click a store to see its details, then click "Fetch Discounts" to load current offers. ALDI fetches instantly via XHR API; REWE fetches via CloakBrowser (bypasses Cloudflare) running on GitHub Actions (~60-90s async).

## Features

- 🗺️ Interactive Leaflet map (Germany, dark theme, OSM tiles)
- 🏪 Brand-colored markers (green=ALDI SÜD, red=REWE)
- 🔍 Brand filter (All / ALDI SÜD / REWE)
- 🏙️ City search (Nominatim geocoding, fly-to)
- 📦 Per-store discount fetching (ALDI: instant, REWE: async via GitHub Actions)
- 🔎 Discount search/filter within sidebar
- ❌ Close button on store sidebar (mobile-friendly)
- ⏱️ Rate limiting (1 fetch per 30s per IP)
- 💾 Supabase persistence (discounts cached across sessions)

## Supported chains

| Brand | Fetch method | Time | Regional? |
|---|---|---|---|
| ALDI SÜD | Direct XHR API | ~5s | No (national) |
| REWE | CloakBrowser + GitHub Actions | ~60-90s | Yes (per-store) |

## Architecture

```
User clicks "Fetch Discounts"
  ├── ALDI SÜD → Vercel serverless fetches via XHR API → saves to Supabase
  └── REWE → triggers GitHub Actions workflow
               → CloakBrowser bypasses Cloudflare
               → Extracts products from DOM (15 category tabs)
               → Saves to Supabase
               → App auto-polls every 10s for results
```

### Modular design (swappable interfaces)

| Module | Interface | Current implementation | Future |
|---|---|---|---|
| Store provider | `StoreProvider` | `JsonStoreProvider` (JSON file) | Supabase |
| Fetcher plugin | `FetcherPlugin` | `DiscountFetcherAldi` (XHR) | Lidl, Netto, Edeka |
| REWE fetcher | Python script | `rewe_fetcher.py` (CloakBrowser) | — |
| Storage | `DiscountStorage` | `SupabaseDiscountStorage` | Turso, S3 |
| Geocoder | `Geocoder` | `NominatimGeocoder` (OSM) | Google |
| Rate limiter | `RateLimiter` | `MemoryRateLimiter` (30s) | Redis |

## Tech stack

- Next.js 16 + TypeScript + Tailwind + shadcn/ui
- Leaflet + OpenStreetMap (CARTO dark tiles)
- Supabase (PostgreSQL for discount storage)
- CloakBrowser (stealth Chromium for REWE Cloudflare bypass)
- GitHub Actions (runs REWE fetcher)
- Vitest (TDD, 19 tests)

## Dev / Prod branches

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | Production | Vercel production (auto on push) |
| `dev` | Development | Vercel preview (auto on push) |

## Local development

```bash
git clone https://github.com/BirdNest055/aldi-map.git
cd aldi-map
git checkout dev
bun install
bun run dev    # → http://localhost:3000
```

### Run tests

```bash
bun run test   # 19 vitest tests
bun run lint   # eslint
```

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/stores` | GET | All stores from JSON |
| `/api/discounts?storeId=X` | GET | Cached discounts from Supabase |
| `/api/fetch` | POST | Trigger fetch (ALDI: inline, REWE: GitHub Actions) |
| `/api/search?q=Berlin` | GET | City search via Nominatim |

## Environment variables

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client-side) |
| `GITHUB_TOKEN` | GitHub PAT (for triggering REWE workflow) |

## GitHub Actions secrets

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | For REWE workflow to save discounts |
| `SUPABASE_SECRET_KEY` | For REWE workflow to authenticate |

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.1.0 | 2026-07-04 | Renamed to discount fetcher, added REWE stores, brand filter, close button, version indicators |
| 1.0.0 | 2026-07-04 | Initial release: ALDI map, fetch, Supabase, city search, rate limiting |

## License

MIT
