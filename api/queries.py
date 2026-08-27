"""Every Cypher statement the application runs, in one file.

Two rules hold throughout:

1. All user input reaches the database as `$name` parameters via the driver. No
   query is assembled by concatenating or interpolating a user-supplied string.
2. openCypher cannot parameterise the bound of a variable-length pattern
   (`-[:FLIES_TO*1..$n]->` is a syntax error). Rather than format user input into
   query text, the ITINERARY_QUERIES / ALLIANCE_QUERIES dicts pre-build one
   finished query per allowed depth at import time, and the request handler looks
   one up by a validated integer key. The user's number selects a query; it never
   becomes part of one.
"""
from __future__ import annotations

from typing import Any

from . import db

# Real itineraries almost never exceed two stops, and an unbounded traversal over
# hub airports with hundreds of edges would be unkind to a 0.5 vCPU free instance.
# Three legs is both realistic and a cost ceiling.
MIN_LEGS, MAX_LEGS = 1, 3

ALLIANCE_IDS = ("star-alliance", "oneworld", "skyteam")

_AIRPORT_SHAPE = """{
    iata: a.iata, icao: a.icao, name: a.name, city: a.city,
    country: a.country, countryCode: a.countryCode, continent: a.continent,
    lat: a.lat, lon: a.lon, destinations: a.destinations
}"""

_STOP_SHAPE = """{
    iata: s.iata, name: s.name, city: s.city, country: s.country,
    lat: s.lat, lon: s.lon
}"""


async def stats() -> dict[str, Any]:
    labels = await db.run("MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count")
    rels = await db.run("MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count")
    alliances = await db.run(
        """
        MATCH ()-[r:FLIES_TO]->()
        RETURN r.alliance AS alliance, count(*) AS count
        ORDER BY count DESC
        """
    )
    return {
        "nodes": {r["label"]: r["count"] for r in labels},
        "relationships": {r["type"]: r["count"] for r in rels},
        "nodeTotal": sum(r["count"] for r in labels),
        "relationshipTotal": sum(r["count"] for r in rels),
        "routesByAlliance": {r["alliance"]: r["count"] for r in alliances},
    }


async def search_airports(term: str, limit: int = 20) -> list[dict[str, Any]]:
    """Match on code, airport name or city. Exact IATA matches sort first, so
    typing 'MNL' puts Manila at the top rather than every airport named Manila."""
    return await db.run(
        f"""
        MATCH (a:Airport)
        WHERE a.iata = toUpper($term)
           OR toLower(a.name) CONTAINS toLower($term)
           OR toLower(a.city) CONTAINS toLower($term)
           OR toLower(a.country) CONTAINS toLower($term)
        RETURN {_AIRPORT_SHAPE} AS airport,
               CASE WHEN a.iata = toUpper($term) THEN 0 ELSE 1 END AS rank
        ORDER BY rank, a.destinations DESC, a.name
        LIMIT $limit
        """,
        term=term,
        limit=limit,
    )


async def airport(iata: str) -> dict[str, Any] | None:
    rows = await db.run(
        f"""
        MATCH (a:Airport {{iata: toUpper($iata)}})
        OPTIONAL MATCH (a)-[r:FLIES_TO]->(d:Airport)
        WITH a, count(DISTINCT d) AS destinationCount,
             collect(DISTINCT r.airline) AS airlineCodes
        RETURN {_AIRPORT_SHAPE} AS airport,
               destinationCount,
               size(airlineCodes) AS airlineCount
        """,
        iata=iata,
    )
    return rows[0] if rows else None


async def destinations_from(iata: str, limit: int = 200) -> list[dict[str, Any]]:
    """Direct flights out of one airport, with who flies each."""
    return await db.run(
        """
        MATCH (a:Airport {iata: toUpper($iata)})-[r:FLIES_TO]->(d:Airport)
        OPTIONAL MATCH (al:Airline {icao: r.airline})
        WITH d, r, al
        ORDER BY al.name
        RETURN d.iata AS iata, d.name AS name, d.city AS city, d.country AS country,
               d.lat AS lat, d.lon AS lon,
               min(r.distanceKm) AS distanceKm,
               collect(DISTINCT {code: r.airline, name: coalesce(al.name, r.airline),
                                 alliance: r.alliance}) AS airlines
        ORDER BY distanceKm
        LIMIT $limit
        """,
        iata=iata,
        limit=limit,
    )


# --- Itinerary search --------------------------------------------------------
# The reason this application is on a graph database. An itinerary is a path of
# unknown length, the alliance rule is a constraint every leg must satisfy, and
# the ranking is an aggregation over the whole path.

_ITINERARY_TEMPLATE = """
MATCH route = (o:Airport {{iata: toUpper($origin)}})-[:FLIES_TO*1..{legs}]->(d:Airport {{iata: toUpper($destination)}})
WHERE ($alliance IS NULL OR ALL(r IN relationships(route) WHERE r.alliance = $alliance))
WITH nodes(route) AS stops, relationships(route) AS legs
// No airport may be visited twice. O(n^2) over a path of at most four nodes.
WHERE ALL(i IN range(0, size(stops) - 2) WHERE NOT stops[i] IN stops[i + 1..])
WITH stops, legs, reduce(total = 0.0, r IN legs | total + r.distanceKm) AS distanceKm
RETURN [s IN stops | {stop_shape}] AS stops,
       [r IN legs | {{airline: r.airline, alliance: r.alliance, distanceKm: r.distanceKm}}] AS legs,
       toInteger(round(distanceKm)) AS distanceKm,
       size(legs) AS legCount
ORDER BY legCount ASC, distanceKm ASC
LIMIT $limit
"""

# The alliance comparison. Every leg of an itinerary must belong to the SAME
# alliance for the ticket to behave as one - which is a constraint on the path as a
# whole, not on any single relationship. Expressed here by checking that every
# leg's alliance equals the first leg's, then keeping the best path per alliance.
_ALLIANCE_TEMPLATE = """
MATCH route = (o:Airport {{iata: toUpper($origin)}})-[:FLIES_TO*1..{legs}]->(d:Airport {{iata: toUpper($destination)}})
WITH nodes(route) AS stops, relationships(route) AS legs
WHERE ALL(i IN range(0, size(stops) - 2) WHERE NOT stops[i] IN stops[i + 1..])
WITH stops, legs, [r IN legs | r.alliance] AS alliances
WHERE alliances[0] <> 'none'
  AND size([x IN alliances WHERE x = alliances[0]]) = size(alliances)
WITH alliances[0] AS alliance, stops, legs,
     reduce(total = 0.0, r IN legs | total + r.distanceKm) AS distanceKm
ORDER BY size(legs) ASC, distanceKm ASC
WITH alliance, head(collect({{
        stops: [s IN stops | {stop_shape}],
        legs: [r IN legs | {{airline: r.airline, alliance: r.alliance, distanceKm: r.distanceKm}}],
        distanceKm: toInteger(round(distanceKm)),
        legCount: size(legs)
     }})) AS best
RETURN alliance, best
ORDER BY best.legCount ASC, best.distanceKm ASC
"""

# One finished query per allowed depth, built once at import. Nothing a user sends
# is ever formatted into query text - their number only picks a key in these dicts.
ITINERARY_QUERIES: dict[int, str] = {
    legs: _ITINERARY_TEMPLATE.format(legs=legs, stop_shape=_STOP_SHAPE)
    for legs in range(MIN_LEGS, MAX_LEGS + 1)
}
ALLIANCE_QUERIES: dict[int, str] = {
    legs: _ALLIANCE_TEMPLATE.format(legs=legs, stop_shape=_STOP_SHAPE)
    for legs in range(MIN_LEGS, MAX_LEGS + 1)
}


async def itineraries(
    origin: str,
    destination: str,
    legs: int,
    alliance: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    if legs not in ITINERARY_QUERIES:
        raise ValueError(f"legs must be between {MIN_LEGS} and {MAX_LEGS}")
    if alliance is not None and alliance not in ALLIANCE_IDS:
        raise ValueError(f"unknown alliance {alliance!r}")
    return await db.run(
        ITINERARY_QUERIES[legs],
        origin=origin,
        destination=destination,
        alliance=alliance,
        limit=limit,
    )


async def alliance_comparison(origin: str, destination: str, legs: int) -> list[dict[str, Any]]:
    if legs not in ALLIANCE_QUERIES:
        raise ValueError(f"legs must be between {MIN_LEGS} and {MAX_LEGS}")
    return await db.run(ALLIANCE_QUERIES[legs], origin=origin, destination=destination)


async def fewest_stops(origin: str, destination: str) -> list[dict[str, Any]]:
    """One line on a graph, and no concise SQL equivalent."""
    return await db.run(
        f"""
        MATCH (o:Airport {{iata: toUpper($origin)}}), (d:Airport {{iata: toUpper($destination)}})
        MATCH route = shortestPath((o)-[:FLIES_TO*..6]->(d))
        RETURN [s IN nodes(route) | {_STOP_SHAPE}] AS stops,
               [r IN relationships(route) | {{airline: r.airline, alliance: r.alliance,
                                              distanceKm: r.distanceKm}}] AS legs,
               size(relationships(route)) AS legCount,
               toInteger(round(reduce(t = 0.0, r IN relationships(route) | t + r.distanceKm))) AS distanceKm
        """,
        origin=origin,
        destination=destination,
    )


async def reach(iata: str, legs: int = 2) -> list[dict[str, Any]]:
    """Which countries open up within N legs, and at what cost in stops.

    The `min(length(route))` is the interesting part: the same country is usually
    reachable several ways, and what a traveller wants is the shortest one.
    """
    if legs not in ITINERARY_QUERIES:
        raise ValueError(f"legs must be between {MIN_LEGS} and {MAX_LEGS}")
    query = f"""
    MATCH route = (o:Airport {{iata: toUpper($iata)}})-[:FLIES_TO*1..{legs}]->(d:Airport)
    WHERE d.iata <> toUpper($iata)
    MATCH (d)-[:IN_COUNTRY]->(c:Country)
    RETURN c.code AS countryCode, c.name AS country,
           count(DISTINCT d) AS airports,
           min(size(relationships(route))) AS fewestLegs
    ORDER BY fewestLegs ASC, airports DESC, country
    """
    return await db.run(query, iata=iata)


async def hubs(limit: int = 25) -> list[dict[str, Any]]:
    """Degree centrality, computed live rather than read off a stored counter."""
    return await db.run(
        """
        MATCH (a:Airport)-[r:FLIES_TO]->(d:Airport)
        WITH a, count(DISTINCT d) AS destinations, count(DISTINCT r.airline) AS airlines
        RETURN a.iata AS iata, a.name AS name, a.city AS city, a.country AS country,
               destinations, airlines
        ORDER BY destinations DESC, airlines DESC
        LIMIT $limit
        """,
        limit=limit,
    )


async def airlines_for_alliance(alliance: str) -> list[dict[str, Any]]:
    return await db.run(
        """
        MATCH (al:Airline)-[:MEMBER_OF]->(a:Alliance {id: $alliance})
        RETURN al.icao AS icao, al.iata AS iata, al.name AS name,
               al.country AS country, al.routeCount AS routeCount
        ORDER BY routeCount DESC, name
        """,
        alliance=alliance,
    )


async def all_airlines() -> list[dict[str, Any]]:
    """Every airline in the graph. Small enough to fetch once and hold client-side,
    which keeps the itinerary query from joining out to Airline on every leg."""
    return await db.run(
        """
        MATCH (al:Airline)
        RETURN al.icao AS icao, al.iata AS iata, al.name AS name,
               al.country AS country, al.alliance AS alliance, al.routeCount AS routeCount
        ORDER BY al.routeCount DESC, al.name
        """
    )


async def alliances() -> list[dict[str, Any]]:
    return await db.run(
        """
        MATCH (a:Alliance)
        OPTIONAL MATCH (al:Airline)-[:MEMBER_OF]->(a)
        RETURN a.id AS id, a.name AS name, a.founded AS founded,
               count(al) AS airlineCount,
               sum(coalesce(al.routeCount, 0)) AS routeCount
        ORDER BY routeCount DESC
        """
    )
