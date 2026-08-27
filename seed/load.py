"""Load the SkyRoute graph into CognoDB.

    python -m seed.load              # create/update the graph
    python -m seed.load --reset      # wipe first, then load
    python -m seed.load --dry-run    # build everything in memory, touch no database

Inputs, all in seed/data/:
    routes.json        collected by seed/collect.py from OpenSky + adsbdb
    airports.csv       OurAirports, trimmed by seed/refresh_airports.py
    alliances.json     alliance membership, cited and checked by check_alliances.py

The join is: a collected route names an airline by ICAO and two airports by IATA.
Airport detail comes from the airport registry, alliance membership from alliances.json, and
the great-circle distance is computed here so the traversal can sum it per hop
without doing trigonometry inside Cypher.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data"

SCHEMA = [
    "CREATE CONSTRAINT airport_iata IF NOT EXISTS FOR (a:Airport) REQUIRE a.iata IS UNIQUE",
    "CREATE CONSTRAINT airline_icao IF NOT EXISTS FOR (a:Airline) REQUIRE a.icao IS UNIQUE",
    "CREATE CONSTRAINT alliance_id IF NOT EXISTS FOR (a:Alliance) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT country_code IF NOT EXISTS FOR (c:Country) REQUIRE c.code IS UNIQUE",
    "CREATE INDEX airport_name IF NOT EXISTS FOR (a:Airport) ON (a.name)",
    "CREATE INDEX airport_city IF NOT EXISTS FOR (a:Airport) ON (a.city)",
    "CREATE INDEX airport_country IF NOT EXISTS FOR (a:Airport) ON (a.countryCode)",
]

ALLIANCES_CYPHER = """
UNWIND $rows AS row
MERGE (a:Alliance {id: row.id})
SET a.name = row.name, a.founded = row.founded
"""

COUNTRIES_CYPHER = """
UNWIND $rows AS row
MERGE (c:Country {code: row.code})
SET c.name = row.name
"""

AIRPORTS_CYPHER = """
UNWIND $rows AS row
MERGE (a:Airport {iata: row.iata})
SET a.icao = row.icao, a.name = row.name, a.city = row.city,
    a.country = row.country, a.countryCode = row.countryCode,
    a.continent = row.continent, a.lat = row.lat, a.lon = row.lon,
    a.type = row.type, a.departures = row.departures, a.destinations = row.destinations
WITH a, row
MATCH (c:Country {code: row.countryCode})
MERGE (a)-[:IN_COUNTRY]->(c)
"""

AIRLINES_CYPHER = """
UNWIND $rows AS row
MERGE (al:Airline {icao: row.icao})
SET al.iata = row.iata, al.name = row.name, al.country = row.country,
    al.alliance = row.alliance, al.routeCount = row.routeCount
"""

MEMBERSHIP_CYPHER = """
UNWIND $rows AS row
MATCH (al:Airline {icao: row.airline}), (a:Alliance {id: row.alliance})
MERGE (al)-[:MEMBER_OF]->(a)
"""

ROUTES_CYPHER = """
UNWIND $rows AS row
MATCH (o:Airport {iata: row.origin}), (d:Airport {iata: row.destination})
MERGE (o)-[r:FLIES_TO {airline: row.airline}]->(d)
SET r.alliance = row.alliance, r.distanceKm = row.distanceKm,
    r.observations = row.observations
"""

BATCH = 500
EARTH_RADIUS_KM = 6371.0088


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine. Good to well under a percent at these distances, and it is the
    distance an aircraft actually flies far more closely than anything Euclidean."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h)), 1)


def load_airports() -> dict[str, dict[str, Any]]:
    """Airport registry rows, keyed by IATA code.

    data/airports.csv is OurAirports filtered to the ~9,000 rows that carry an IATA
    code and the columns actually used, which takes it from 13 MB to under 1 MB.
    Refresh it with seed/refresh_airports.py.
    """
    airports: dict[str, dict[str, Any]] = {}
    with (DATA / "airports.csv").open(encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            iata = (row.get("iata_code") or "").strip().upper()
            if len(iata) != 3:
                continue
            try:
                lat, lon = float(row["latitude_deg"]), float(row["longitude_deg"])
            except (TypeError, ValueError):
                continue
            airports[iata] = {
                "iata": iata,
                "icao": (row.get("icao_code") or row.get("ident") or "").strip(),
                "name": (row.get("name") or "").strip(),
                "city": (row.get("municipality") or "").strip(),
                "countryCode": (row.get("iso_country") or "").strip().upper(),
                "continent": (row.get("continent") or "").strip(),
                "lat": lat,
                "lon": lon,
                "type": (row.get("type") or "").strip(),
            }
    return airports


def load_countries() -> dict[str, str]:
    path = DATA / "ourairports-countries.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", errors="replace", newline="") as handle:
        return {
            (r.get("code") or "").strip().upper(): (r.get("name") or "").strip()
            for r in csv.DictReader(handle)
            if (r.get("code") or "").strip()
        }


def build_payload() -> dict[str, Any]:
    routes_file = json.loads((DATA / "routes.json").read_text(encoding="utf-8"))
    alliances_file = json.loads((DATA / "alliances.json").read_text(encoding="utf-8"))
    airports = load_airports()
    country_names = load_countries()

    alliance_of: dict[str, str] = {}
    for alliance_id, members in alliances_file["members"].items():
        for member in members:
            alliance_of[member["icao"]] = alliance_id

    airline_rows = {a["icao"] or a["code"]: a for a in routes_file["airlines"]}

    # Keep only routes where both endpoints are airports we can actually place on a
    # map. An unresolvable IATA code cannot contribute a usable edge.
    kept: list[dict[str, Any]] = []
    dropped = 0
    for route in routes_file["routes"]:
        origin, destination = airports.get(route["origin"]), airports.get(route["destination"])
        if not origin or not destination:
            dropped += 1
            continue
        icao = route["airline"]
        kept.append({
            "airline": icao,
            "origin": route["origin"],
            "destination": route["destination"],
            "alliance": alliance_of.get(icao, "none"),
            "distanceKm": great_circle_km(origin["lat"], origin["lon"],
                                          destination["lat"], destination["lon"]),
            "observations": route.get("observations", 1),
        })

    used_airports = {r["origin"] for r in kept} | {r["destination"] for r in kept}
    used_airlines = {r["airline"] for r in kept}

    departures: dict[str, int] = {}
    destinations: dict[str, set[str]] = {}
    for route in kept:
        departures[route["origin"]] = departures.get(route["origin"], 0) + 1
        destinations.setdefault(route["origin"], set()).add(route["destination"])

    airport_rows = []
    for iata in sorted(used_airports):
        record = dict(airports[iata])
        record["country"] = country_names.get(record["countryCode"], record["countryCode"])
        record["departures"] = departures.get(iata, 0)
        record["destinations"] = len(destinations.get(iata, ()))
        airport_rows.append(record)

    route_counts: dict[str, int] = {}
    for route in kept:
        route_counts[route["airline"]] = route_counts.get(route["airline"], 0) + 1

    airline_out = []
    for icao in sorted(used_airlines):
        source = airline_rows.get(icao, {})
        airline_out.append({
            "icao": icao,
            "iata": source.get("iata", ""),
            "name": source.get("name", icao),
            "country": source.get("country", ""),
            "alliance": alliance_of.get(icao, "none"),
            "routeCount": route_counts.get(icao, 0),
        })

    country_rows = [
        {"code": code, "name": country_names.get(code, code)}
        for code in sorted({r["countryCode"] for r in airport_rows if r["countryCode"]})
    ]

    return {
        "meta": {
            "collectedAt": routes_file.get("collectedAt"),
            "note": routes_file.get("note"),
            "droppedRoutes": dropped,
        },
        "alliances": alliances_file["alliances"],
        "countries": country_rows,
        "airports": airport_rows,
        "airlines": airline_out,
        "memberships": [
            {"airline": a["icao"], "alliance": a["alliance"]}
            for a in airline_out
            if a["alliance"] != "none"
        ],
        "routes": kept,
    }


def _batches(rows: list[dict[str, Any]]):
    for i in range(0, len(rows), BATCH):
        yield rows[i : i + BATCH]


def summarise(payload: dict[str, Any]) -> None:
    by_alliance: dict[str, int] = {}
    for route in payload["routes"]:
        by_alliance[route["alliance"]] = by_alliance.get(route["alliance"], 0) + 1

    print(f"collected at   {payload['meta']['collectedAt']}")
    print(f"countries      {len(payload['countries']):>6}")
    print(f"airports       {len(payload['airports']):>6}")
    print(f"airlines       {len(payload['airlines']):>6}")
    print(f"routes         {len(payload['routes']):>6}")
    for alliance, count in sorted(by_alliance.items(), key=lambda kv: -kv[1]):
        print(f"  {alliance:<14} {count:>6}")
    if payload["meta"]["droppedRoutes"]:
        print(f"\ndropped {payload['meta']['droppedRoutes']} routes with an unresolvable airport code")

    nodes = (len(payload["airports"]) + len(payload["airlines"])
             + len(payload["alliances"]) + len(payload["countries"]))
    rels = (len(payload["routes"]) + len(payload["memberships"]) + len(payload["airports"]))
    print(f"\ntotal nodes    {nodes:>6}")
    print(f"total rels     {rels:>6}")


def write(payload: dict[str, Any], reset: bool) -> None:
    import os

    from dotenv import load_dotenv
    from neo4j import GraphDatabase
    from neo4j.exceptions import ClientError, Neo4jError, ServiceUnavailable

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    uri, password = os.getenv("COGNODB_URI"), os.getenv("COGNODB_PASSWORD")
    if not uri or not password:
        raise SystemExit(
            "COGNODB_URI and COGNODB_PASSWORD must be set. Copy .env.example to .env first."
        )

    try:
        driver = GraphDatabase.driver(uri, auth=(os.getenv("COGNODB_USER", "cognodb"), password))
        driver.verify_connectivity()
    except (ServiceUnavailable, Neo4jError) as exc:
        raise SystemExit(f"Could not reach CognoDB at {uri}: {exc}")

    with driver:
        if reset:
            print("wiping existing graph...")
            driver.execute_query("MATCH (n) DETACH DELETE n")

        for statement in SCHEMA:
            try:
                driver.execute_query(statement)
            except ClientError as exc:
                print(f"  skipped schema statement ({exc.code}): {statement.split(' FOR ')[0]}")

        steps = [
            ("alliances", ALLIANCES_CYPHER, payload["alliances"]),
            ("countries", COUNTRIES_CYPHER, payload["countries"]),
            ("airports", AIRPORTS_CYPHER, payload["airports"]),
            ("airlines", AIRLINES_CYPHER, payload["airlines"]),
            ("memberships", MEMBERSHIP_CYPHER, payload["memberships"]),
            ("routes", ROUTES_CYPHER, payload["routes"]),
        ]
        for label, cypher, rows in steps:
            for batch in _batches(rows):
                driver.execute_query(cypher, rows=batch)
            print(f"  wrote {len(rows):>6} {label}")

    print("\ndone.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Load the SkyRoute graph into CognoDB.")
    parser.add_argument("--reset", action="store_true", help="delete all nodes before loading")
    parser.add_argument("--dry-run", action="store_true", help="build in memory, no database")
    args = parser.parse_args()

    if not (DATA / "routes.json").exists():
        raise SystemExit("seed/data/routes.json is missing. Run: python -m seed.collect")

    payload = build_payload()
    summarise(payload)

    if args.dry_run:
        print("\ndry run - nothing written.")
        return 0
    print()
    write(payload, args.reset)
    return 0


if __name__ == "__main__":
    sys.exit(main())
