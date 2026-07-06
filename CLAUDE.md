# CLAUDE.md — discount-map

## What this app does
Interactive map of German supermarkets (ALDI SÜD + REWE) with discount fetching.
Users click a store marker → fetch discounts → see products in sidebar.

## Key files
- `src/app/page.tsx` — main page (header, map, sidebar, product search, city search)
- `src/components/MapView.tsx` — Leaflet map with clustering, light theme, marker highlighting
- `src/lib/stores/supabase-provider.ts` — reads stores from Supabase (5-min cache, paginated)
- `src/app/api/fetch/route.ts` — triggers ALDI (inline) or REWE (GHA) fetch
- `src/app/api/product-search/route.ts` — proxies product search to discount-database
- `src/app/api/discounts/route.ts` — returns discounts for a store
- `.github/workflows/rewe-fetch.yml` — CloakBrowser REWE fetcher (MUST have `id: fetch`)
- `fetchers/rewe_fetcher.py` — CloakBrowser Python script
- `data/stores.json` — DEPRECATED, use Supabase stores table instead

## Current version: 1.9.0
## Tech: Next.js 16, Tailwind v4, Leaflet, Supabase, react-leaflet-cluster
## Live URL: https://aldi-map-birdnest055s-projects.vercel.app
