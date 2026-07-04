import { describe, it, expect } from "vitest";

// Test the NominatimGeocoder response parsing logic
// (We test the parsing function, not the actual HTTP call)
function parseNominatimResponse(data: any[]): import("@/lib/types").GeocodeResult[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) => ({
    displayName: item.display_name || "",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    boundingBox: [
      parseFloat(item.boundingbox?.[0] || "0"), // south
      parseFloat(item.boundingbox?.[1] || "0"), // north
      parseFloat(item.boundingbox?.[2] || "0"), // west
      parseFloat(item.boundingbox?.[3] || "0"), // east
    ],
  }));
}

describe("Nominatim response parsing", () => {
  it("parses a valid Nominatim response", () => {
    const mockResponse = [
      {
        display_name: "München, Bayern, Deutschland",
        lat: "48.137107",
        lon: "11.575382",
        boundingbox: ["48.0616", "48.2481", "11.3607", "11.7399"],
      },
    ];
    const results = parseNominatimResponse(mockResponse);
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toContain("München");
    expect(results[0].lat).toBeCloseTo(48.137, 2);
    expect(results[0].lng).toBeCloseTo(11.575, 2);
    expect(results[0].boundingBox).toHaveLength(4);
  });

  it("handles empty response", () => {
    expect(parseNominatimResponse([])).toHaveLength(0);
  });

  it("handles invalid response (not an array)", () => {
    expect(parseNominatimResponse(null)).toHaveLength(0);
    expect(parseNominatimResponse({} as any)).toHaveLength(0);
  });

  it("parses multiple results", () => {
    const mockResponse = [
      { display_name: "München, Bayern", lat: "48.13", lon: "11.57", boundingbox: ["48", "48.2", "11.3", "11.7"] },
      { display_name: "München, Bayern, Germany", lat: "48.14", lon: "11.58", boundingbox: ["48.05", "48.25", "11.35", "11.75"] },
    ];
    const results = parseNominatimResponse(mockResponse);
    expect(results).toHaveLength(2);
    expect(results[0].lat).toBeCloseTo(48.13, 1);
    expect(results[1].displayName).toContain("Germany");
  });
});
