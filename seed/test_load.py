"""Checks on the join and distance logic in load.py.

    python -m seed.test_load

These run without a database and without network access. The join is where three
independent sources meet, so it is where a silent mismatch would hide - a route
whose airport code does not resolve, an alliance attached to the wrong airline, a
distance computed from swapped coordinates.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .load import DATA, build_payload, great_circle_km, load_airports


def test_great_circle_matches_known_distances():
    # Published great-circle distances, accurate to about a percent.
    cases = [
        # (lat1, lon1, lat2, lon2, expected km, label)
        (51.4706, -0.4619, 40.6413, -73.7781, 5555, "LHR-JFK"),
        (14.5086, 121.0200, 35.5494, 139.7798, 2999, "MNL-HND"),
        (-33.9461, 151.1772, -37.6690, 144.8410, 705, "SYD-MEL"),
    ]
    for lat1, lon1, lat2, lon2, expected, label in cases:
        actual = great_circle_km(lat1, lon1, lat2, lon2)
        error = abs(actual - expected) / expected
        assert error < 0.02, f"{label}: got {actual} km, expected about {expected} km"


def test_distance_is_symmetric_and_zero_on_self():
    assert great_circle_km(10.0, 20.0, 10.0, 20.0) == 0.0
    there = great_circle_km(51.47, -0.46, 40.64, -73.78)
    back = great_circle_km(40.64, -73.78, 51.47, -0.46)
    assert there == back


def test_airport_registry_is_sane():
    airports = load_airports()
    assert len(airports) > 5000, f"only {len(airports)} airports loaded"
    for iata, row in airports.items():
        assert len(iata) == 3 and iata.isalpha(), f"bad IATA code {iata!r}"
        assert -90 <= row["lat"] <= 90, f"{iata} latitude {row['lat']} out of range"
        assert -180 <= row["lon"] <= 180, f"{iata} longitude {row['lon']} out of range"
    known = {"MNL": "Philippines", "JFK": "United States", "LHR": "United Kingdom"}
    for iata in known:
        assert iata in airports, f"{iata} missing from the registry"


def test_payload_joins_cleanly():
    if not (DATA / "routes.json").exists():
        print("  skip  test_payload_joins_cleanly (routes.json not collected yet)")
        return

    payload = build_payload()
    airports = {a["iata"] for a in payload["airports"]}
    airlines = {a["icao"] for a in payload["airlines"]}
    alliance_ids = {a["id"] for a in payload["alliances"]} | {"none"}
    countries = {c["code"] for c in payload["countries"]}

    assert payload["routes"], "no routes survived the join"

    for route in payload["routes"]:
        assert route["origin"] in airports, f"route origin {route['origin']} has no Airport node"
        assert route["destination"] in airports, f"route destination missing"
        assert route["airline"] in airlines, f"route airline {route['airline']} has no Airline node"
        assert route["alliance"] in alliance_ids, f"unknown alliance {route['alliance']}"
        assert route["origin"] != route["destination"], "self-loop route"
        assert route["distanceKm"] >= 0, "negative distance"

    for airport in payload["airports"]:
        assert airport["countryCode"] in countries, f"{airport['iata']} country not loaded"

    # Every membership edge must point at a real alliance and a real airline.
    for membership in payload["memberships"]:
        assert membership["airline"] in airlines
        assert membership["alliance"] in alliance_ids - {"none"}

    # An airline carries exactly one alliance, and it must agree with its routes.
    by_airline = {a["icao"]: a["alliance"] for a in payload["airlines"]}
    for route in payload["routes"]:
        assert route["alliance"] == by_airline[route["airline"]], (
            f"{route['airline']} route says {route['alliance']} but airline says "
            f"{by_airline[route['airline']]}"
        )


def test_no_alliance_route_without_a_member_airline():
    if not (DATA / "routes.json").exists():
        print("  skip  test_no_alliance_route_without_a_member_airline")
        return
    payload = build_payload()
    alliances = json.loads((DATA / "alliances.json").read_text(encoding="utf-8"))
    members = {m["icao"] for group in alliances["members"].values() for m in group}
    for route in payload["routes"]:
        if route["alliance"] != "none":
            assert route["airline"] in members, (
                f"{route['airline']} tagged {route['alliance']} but is not in the member table"
            )


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"  pass  {test.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"  FAIL  {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
