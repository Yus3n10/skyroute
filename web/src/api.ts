/** Typed client for the SkyRoute API.
 *
 * Every call funnels through `request`, so a database outage surfaces as one
 * ApiError with a readable message rather than a JSON parse failure three
 * components deep.
 */

export type AllianceId = "star-alliance" | "oneworld" | "skyteam" | "none";

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  continent: string;
  lat: number;
  lon: number;
  destinations: number;
}

export interface AirportDetail {
  airport: Airport;
  destinationCount: number;
  airlineCount: number;
}

export interface Leg {
  airline: string;
  alliance: AllianceId;
  distanceKm: number;
}

export interface Stop {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface Itinerary {
  stops: Stop[];
  legs: Leg[];
  distanceKm: number;
  legCount: number;
}

export interface AllianceOption {
  alliance: Exclude<AllianceId, "none">;
  best: Itinerary;
}

export interface Alliance {
  id: AllianceId;
  name: string;
  founded: number;
  airlineCount: number;
  routeCount: number;
}

export interface Airline {
  icao: string;
  iata: string;
  name: string;
  country: string;
  alliance?: AllianceId;
  routeCount: number;
}

export interface Destination {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  distanceKm: number;
  airlines: { code: string; name: string; alliance: AllianceId }[];
}

export interface ReachRow {
  countryCode: string;
  country: string;
  airports: number;
  fewestLegs: number;
}

export interface Hub {
  iata: string;
  name: string;
  city: string;
  country: string;
  destinations: number;
  airlines: number;
}

export interface Stats {
  nodes: Record<string, number>;
  relationships: Record<string, number>;
  nodeTotal: number;
  relationshipTotal: number;
  routesByAlliance: Record<string, number>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // The request never left the browser - offline, or the API process is down.
    throw new ApiError("Could not reach the server.", 0, "Check that the API is running.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.detail ?? body?.error ?? `Request failed with status ${response.status}.`,
      response.status,
      body?.hint,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; database: string }>("/health"),
  stats: () => request<Stats>("/stats"),
  airlines: () => request<Airline[]>("/airlines"),
  alliances: () => request<Alliance[]>("/alliances"),
  allianceAirlines: (id: string) => request<Airline[]>(`/alliances/${id}/airlines`),
  hubs: (limit = 25) => request<Hub[]>(`/hubs?limit=${limit}`),
  searchAirports: (q: string) =>
    request<Airport[]>(`/airports/search?q=${encodeURIComponent(q)}`),
  airport: (iata: string) => request<AirportDetail>(`/airports/${iata}`),
  destinations: (iata: string) => request<Destination[]>(`/airports/${iata}/destinations`),
  reach: (iata: string, legs: number) =>
    request<ReachRow[]>(`/airports/${iata}/reach?legs=${legs}`),
  itineraries: (origin: string, destination: string, maxLegs: number, alliance: string | null) =>
    request<{ origin: Airport; destination: Airport; itineraries: Itinerary[] }>("/itineraries", {
      method: "POST",
      body: JSON.stringify({ origin, destination, maxLegs, alliance }),
    }),
  compareAlliances: (origin: string, destination: string, legs: number) =>
    request<AllianceOption[]>(
      `/itineraries/alliances?origin=${origin}&destination=${destination}&legs=${legs}`,
    ),
};

export const ALLIANCE_LABELS: Record<AllianceId, string> = {
  "star-alliance": "Star Alliance",
  oneworld: "oneworld",
  skyteam: "SkyTeam",
  none: "No alliance",
};

/** One place decides how an alliance reads, so the colour never drifts.
 *  Text colour only - the chip draws its own border from currentColor, which is
 *  what keeps a stamp looking stamped. */
export const ALLIANCE_CLASS: Record<AllianceId, string> = {
  "star-alliance": "text-star",
  oneworld: "text-oneworld",
  skyteam: "text-skyteam",
  none: "text-unaligned",
};

export function formatKm(km: number): string {
  return `${km.toLocaleString()} km`;
}
