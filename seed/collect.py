"""Build a current airline route network from live observations.

    python -m seed.collect                 # one snapshot, resolve everything new
    python -m seed.collect --snapshots 3   # spread snapshots out to widen coverage
    python -m seed.collect --resolve-only  # resolve whatever is already queued

Why this exists instead of a static download: the well-known open route dataset
(OpenFlights routes.dat) has not been updated since 2014. It still lists 798 Air
Berlin routes, an airline that ceased operating in 2017. Building a route planner
on it would produce confident, wrong answers.

So the network here is assembled from two live sources instead:

  1. OpenSky Network  - what is airborne right now, by callsign.
  2. adsbdb           - resolves a callsign to its airline, origin and destination.

The result is a snapshot of routes actually being flown, not a schedule anybody
published and not anything invented. The honest limitation is that coverage
follows ADS-B receiver density, so Europe and North America are represented much
better than oceanic and remote regions. `seed/data/routes.json` records the
sampling window so that limitation travels with the data.

Both APIs are free and unauthenticated. This script rate-limits itself to roughly
one request per second, identifies itself in the User-Agent, and caches every
resolved callsign to disk so a re-run costs nothing and an interrupted run resumes.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data"
CACHE_PATH = DATA / "callsign-cache.json"
ROUTES_PATH = DATA / "routes.json"

OPENSKY_STATES = "https://opensky-network.org/api/states/all"
ADSBDB_CALLSIGN = "https://api.adsbdb.com/v0/callsign/{callsign}"
USER_AGENT = "skyroute-graph/1.0 (CognoDB take-home; contact via GitHub Yus3n10/skyroute)"

# Commercial flight numbers are a 3-letter ICAO airline designator followed by 1-4
# digits and an optional suffix. This filters out private and military traffic,
# which has no scheduled route to resolve.
COMMERCIAL_CALLSIGN = re.compile(r"[A-Z]{3}\d{1,4}[A-Z]?$")

REQUEST_DELAY = 0.5   # seconds between adsbdb calls - be a good citizen
SNAPSHOT_GAP = 900    # seconds between OpenSky snapshots


def _get(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"  ! {path.name} was corrupt, starting fresh")
        return default


def snapshot_callsigns() -> set[str]:
    """Every commercial callsign airborne in one global OpenSky snapshot."""
    try:
        payload = _get(OPENSKY_STATES, timeout=90)
    except Exception as exc:
        print(f"  ! OpenSky snapshot failed: {type(exc).__name__}: {exc}")
        return set()

    states = payload.get("states") or []
    found = {
        state[1].strip()
        for state in states
        if state[1] and COMMERCIAL_CALLSIGN.fullmatch(state[1].strip())
    }
    print(f"  {len(states)} aircraft airborne, {len(found)} commercial callsigns")
    return found


def resolve(callsign: str) -> dict[str, Any] | None:
    """One callsign to a route, or None if adsbdb does not know it.

    A 404 is an ordinary answer here, not an error: plenty of airborne callsigns
    are charters, repositioning flights or simply not in the database.
    """
    try:
        body = _get(ADSBDB_CALLSIGN.format(callsign=callsign), timeout=20)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        if exc.code == 429:
            print("  ! rate limited, backing off 30s")
            time.sleep(30)
        return None
    except Exception:
        return None

    route = (body.get("response") or {})
    route = route.get("flightroute") if isinstance(route, dict) else None
    if not route:
        return None

    airline, origin, destination = route.get("airline"), route.get("origin"), route.get("destination")
    if not (airline and origin and destination):
        return None
    if not (origin.get("iata_code") and destination.get("iata_code")):
        return None
    if origin["iata_code"] == destination["iata_code"]:
        return None  # positioning or return-to-field, not a route

    return {
        "airlineName": airline.get("name", "").strip(),
        "airlineIata": (airline.get("iata") or "").strip(),
        "airlineIcao": (airline.get("icao") or "").strip(),
        "airlineCountry": airline.get("country", "").strip(),
        "origin": origin["iata_code"].strip(),
        "destination": destination["iata_code"].strip(),
    }


def collect(snapshots: int, resolve_only: bool) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    cache: dict[str, Any] = _load_json(CACHE_PATH, {})
    queue: set[str] = set(_load_json(DATA / "callsign-queue.json", []))
    print(f"cache holds {len(cache)} resolved callsigns, {len(queue)} queued\n")

    if not resolve_only:
        for i in range(snapshots):
            print(f"snapshot {i + 1}/{snapshots}")
            queue |= snapshot_callsigns()
            (DATA / "callsign-queue.json").write_text(json.dumps(sorted(queue)), encoding="utf-8")
            if i < snapshots - 1:
                print(f"  waiting {SNAPSHOT_GAP}s to catch a different part of the world\n")
                time.sleep(SNAPSHOT_GAP)
        print()

    # Shuffle rather than resolve in sorted order. A callsign is an airline prefix
    # plus a flight number, so alphabetical order works through one carrier at a
    # time - an interrupted run leaves a cache that is 100% American Airlines
    # instead of a cross-section of the network. Seeded so the order is still
    # reproducible between runs.
    pending = sorted(queue - cache.keys())
    random.Random(20260827).shuffle(pending)
    print(f"{len(pending)} callsigns to resolve (~{len(pending) * REQUEST_DELAY / 60:.0f} min)\n")

    for index, callsign in enumerate(pending, start=1):
        cache[callsign] = resolve(callsign)
        time.sleep(REQUEST_DELAY)
        if index % 100 == 0 or index == len(pending):
            hits = sum(1 for v in cache.values() if v)
            CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
            print(f"  {index}/{len(pending)} resolved, {hits} routes known so far")

    CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
    write_routes(cache)


def write_routes(cache: dict[str, Any]) -> None:
    """Collapse resolved callsigns into distinct airline + origin + destination."""
    routes: dict[tuple[str, str, str], dict[str, Any]] = {}
    airlines: dict[str, dict[str, Any]] = {}

    for entry in cache.values():
        if not entry:
            continue
        code = entry["airlineIcao"] or entry["airlineIata"]
        if not code:
            continue
        airlines.setdefault(code, {
            "code": code,
            "name": entry["airlineName"],
            "iata": entry["airlineIata"],
            "icao": entry["airlineIcao"],
            "country": entry["airlineCountry"],
        })
        key = (code, entry["origin"], entry["destination"])
        if key not in routes:
            routes[key] = {
                "airline": code,
                "origin": entry["origin"],
                "destination": entry["destination"],
                "observations": 0,
            }
        routes[key]["observations"] += 1

    payload = {
        "collectedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "callsigns": "OpenSky Network /states/all",
            "routes": "adsbdb.com /v0/callsign",
            "airports": "OurAirports airports.csv",
        },
        "note": (
            "Routes observed via ADS-B, not a published schedule. Coverage follows "
            "receiver density, so Europe and North America are better represented "
            "than oceanic and remote regions."
        ),
        "callsignsSeen": len(cache),
        "callsignsResolved": sum(1 for v in cache.values() if v),
        "airlines": sorted(airlines.values(), key=lambda a: a["code"]),
        "routes": sorted(routes.values(), key=lambda r: (r["airline"], r["origin"], r["destination"])),
    }
    ROUTES_PATH.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    airports = {r["origin"] for r in payload["routes"]} | {r["destination"] for r in payload["routes"]}
    print(f"\nwrote {ROUTES_PATH.name}")
    print(f"  {len(payload['routes'])} distinct routes")
    print(f"  {len(payload['airlines'])} airlines")
    print(f"  {len(airports)} airports touched")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--snapshots", type=int, default=1, help="OpenSky snapshots to take")
    parser.add_argument("--resolve-only", action="store_true", help="skip snapshots, drain the queue")
    parser.add_argument("--rebuild", action="store_true", help="rewrite routes.json from cache only")
    args = parser.parse_args()

    if args.rebuild:
        write_routes(_load_json(CACHE_PATH, {}))
        return 0

    collect(args.snapshots, args.resolve_only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
