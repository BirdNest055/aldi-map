import type { Geocoder, GeocodeResult } from "@/lib/types";

/**
 * Geocoder using OpenStreetMap's Nominatim API.
 * Free, no API key required. Rate limited to ~1 req/sec (Nominatim's usage policy).
 * Restricted to Germany for this app.
 */
export class NominatimGeocoder implements Geocoder {
  private baseUrl = "https://nominatim.openstreetmap.org/search";

  async search(query: string): Promise<GeocodeResult[]> {
    if (!query || query.trim().length < 2) return [];

    const params = new URLSearchParams({
      q: query,
      format: "json",
      limit: "5",
      countrycodes: "de", // Germany only
      addressdetails: "0",
    });

    try {
      const res = await fetch(`${this.baseUrl}?${params}`, {
        headers: {
          "User-Agent": "aldi-discount-map/1.0",
        },
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data.map((item: any) => ({
        displayName: item.display_name || "",
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        boundingBox: [
          parseFloat(item.boundingbox?.[0] || "0"),
          parseFloat(item.boundingbox?.[1] || "0"),
          parseFloat(item.boundingbox?.[2] || "0"),
          parseFloat(item.boundingbox?.[3] || "0"),
        ],
      }));
    } catch {
      return [];
    }
  }
}

let _geocoder: NominatimGeocoder | null = null;

export function getGeocoder(): NominatimGeocoder {
  if (!_geocoder) {
    _geocoder = new NominatimGeocoder();
  }
  return _geocoder;
}
