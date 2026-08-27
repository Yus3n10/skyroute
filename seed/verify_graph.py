"""End-to-end checks against the live CognoDB graph.

    python -m seed.verify_graph

Runs every query the application exposes and asserts things that must be true of
the result, not just that the query returned without erroring. Several checks are
about the shape of the answer - an itinerary must actually start where you asked,
an alliance-filtered itinerary must not contain a leg from another alliance - which
is the class of bug that a "did it throw?" test will happily miss.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api import db, queries  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(("  OK   " if condition else "  FAIL ") + name + ("" if condition else f"  <- {detail}"))
    if not condition:
        FAILURES.append(name)


async def main() -> int:
    await db.connect()

    stats = await queries.stats()
    check("stats returns a populated graph", stats["nodeTotal"] > 0 and stats["relationshipTotal"] > 0, stats)
    print("        nodes:", stats["nodes"])
    print("        rels: ", stats["relationships"])
    print("        by alliance:", stats["routesByAlliance"])

    hubs = await queries.hubs(10)
    check("hubs returns results", len(hubs) > 0, len(hubs))
    check(
        "hubs are ordered by destination count",
        all(hubs[i]["destinations"] >= hubs[i + 1]["destinations"] for i in range(len(hubs) - 1)),
        [h["destinations"] for h in hubs],
    )
    print("        busiest:", ", ".join(f"{h['iata']}({h['destinations']})" for h in hubs[:6]))

    busiest = hubs[0]["iata"]

    # Search must put an exact IATA match first, or the picker is unusable.
    found = await queries.search_airports(busiest)
    check("exact IATA search ranks first", found and found[0]["airport"]["iata"] == busiest,
          [f["airport"]["iata"] for f in found[:3]])

    missing = await queries.airport("ZZZ")
    check("unknown airport returns None", missing is None, missing)

    detail = await queries.airport(busiest)
    check("airport detail resolves", detail is not None and detail["destinationCount"] > 0, detail)

    outbound = await queries.destinations_from(busiest)
    check("destinations returns results", len(outbound) > 0, len(outbound))
    check("destinations are distance-ordered",
          all(outbound[i]["distanceKm"] <= outbound[i + 1]["distanceKm"] for i in range(len(outbound) - 1)),
          [d["distanceKm"] for d in outbound[:5]])
    check("no airport lists itself as a destination",
          all(d["iata"] != busiest for d in outbound))
    check("every destination carries at least one airline",
          all(len(d["airlines"]) > 0 for d in outbound))

    # Pick a real pair that the graph can definitely connect: the busiest hub and
    # something two hops away from it.
    target = outbound[len(outbound) // 2]["iata"]

    for legs in range(queries.MIN_LEGS, queries.MAX_LEGS + 1):
        found = await queries.itineraries(busiest, target, legs, limit=10)
        check(f"itineraries legs<={legs} returns results", len(found) > 0, len(found))
        if not found:
            continue
        check(f"legs<={legs}: every itinerary starts at the origin",
              all(i["stops"][0]["iata"] == busiest for i in found))
        check(f"legs<={legs}: every itinerary ends at the destination",
              all(i["stops"][-1]["iata"] == target for i in found))
        check(f"legs<={legs}: leg count is respected",
              all(i["legCount"] <= legs for i in found), [i["legCount"] for i in found])
        check(f"legs<={legs}: no airport is visited twice",
              all(len({s["iata"] for s in i["stops"]}) == len(i["stops"]) for i in found))
        check(f"legs<={legs}: results ordered by stops then distance",
              all((found[i]["legCount"], found[i]["distanceKm"])
                  <= (found[i + 1]["legCount"], found[i + 1]["distanceKm"])
                  for i in range(len(found) - 1)))
        check(f"legs<={legs}: distance equals the sum of its legs",
              all(abs(i["distanceKm"] - round(sum(l["distanceKm"] for l in i["legs"]))) <= 1
                  for i in found))

    # The alliance filter must hold on EVERY leg, which is the whole point.
    for alliance in queries.ALLIANCE_IDS:
        filtered = await queries.itineraries(busiest, target, queries.MAX_LEGS, alliance, limit=10)
        check(f"alliance filter {alliance} holds on every leg",
              all(all(l["alliance"] == alliance for l in i["legs"]) for i in filtered),
              [[l["alliance"] for l in i["legs"]] for i in filtered[:3]])

    comparison = await queries.alliance_comparison(busiest, target, queries.MAX_LEGS)
    check("alliance comparison returns at most one row per alliance",
          len({row["alliance"] for row in comparison}) == len(comparison), comparison)
    check("alliance comparison rows are internally consistent",
          all(all(l["alliance"] == row["alliance"] for l in row["best"]["legs"]) for row in comparison))
    for row in comparison:
        print(f"        {row['alliance']}: {row['best']['legCount']} leg(s), {row['best']['distanceKm']} km")

    shortest = await queries.fewest_stops(busiest, target)
    check("fewest_stops finds a path", len(shortest) == 1, shortest)
    if shortest:
        route = shortest[0]
        check("fewest_stops starts and ends correctly",
              route["stops"][0]["iata"] == busiest and route["stops"][-1]["iata"] == target)

    reachable = await queries.reach(busiest, queries.MAX_LEGS)
    check("reach returns countries", len(reachable) > 0, len(reachable))
    check("reach is ordered by fewest legs",
          all(reachable[i]["fewestLegs"] <= reachable[i + 1]["fewestLegs"]
              for i in range(len(reachable) - 1)))
    check("reach leg counts are within bounds",
          all(1 <= r["fewestLegs"] <= queries.MAX_LEGS for r in reachable),
          {r["fewestLegs"] for r in reachable})
    print(f"        {busiest} reaches {len(reachable)} countries within {queries.MAX_LEGS} legs")

    alliances = await queries.alliances()
    check("three alliances are loaded", len(alliances) == 3, [a["id"] for a in alliances])
    for alliance in alliances:
        members = await queries.airlines_for_alliance(alliance["id"])
        check(f"{alliance['id']} has member airlines", len(members) > 0, len(members))

    # Bad input must be refused before it reaches the database. Derived from the
    # configured cap so this keeps testing the real boundary if the cap moves.
    for bad in (0, queries.MIN_LEGS - 1, queries.MAX_LEGS + 1, 99):
        try:
            await queries.itineraries(busiest, target, bad)
            check(f"leg bound {bad} rejected", False, "no error raised")
        except ValueError:
            check(f"leg bound {bad} rejected", True)
    try:
        await queries.itineraries(busiest, target, 2, "not-an-alliance")
        check("unknown alliance rejected", False, "no error raised")
    except ValueError:
        check("unknown alliance rejected", True)

    await db.close()
    print("\nALL PASSED" if not FAILURES else f"\n{len(FAILURES)} FAILED: {FAILURES}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
