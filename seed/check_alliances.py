"""Cross-check the hand-entered alliance table.

    python -m seed.check_alliances

The alliance roster in data/alliances.json is the only data in this project typed
by a human rather than pulled from an API, which makes it the most likely place for
an error to hide. It gets two independent checks:

  ERRORS   Structural facts that must hold regardless of any outside source:
           no airline appears in two alliances, no duplicate codes, codes are
           well-formed. A failure here is a real data-entry bug.

  NOTICES  Agreement with the OpenFlights airline registry. This registry was last
           updated in 2014, so disagreement does NOT mean we are wrong - it usually
           means the registry is stale. Brussels Airlines is filed there under its
           retired DAT code, Fiji Airways under its old name Air Pacific, and ITA
           Airways did not exist yet. Notices are printed for a human to eyeball,
           and deliberately do not fail the check.

Once seed/data/routes.json exists, the collected adsbdb airline records are used as
a third, current oracle - that one is contemporary, so ICAO/IATA disagreement there
IS treated as an error.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"


def load_registry() -> dict[str, list[dict[str, str]]]:
    """OpenFlights airlines.dat, keyed by ICAO. One code can have several rows -
    SWR carries both modern Swiss and the long-defunct Swissair - so keep them all
    and let a match against any of them count."""
    registry: dict[str, list[dict[str, str]]] = {}
    with (DATA / "openflights-airlines.dat").open(encoding="utf-8", errors="replace") as handle:
        for row in csv.reader(handle):
            if len(row) < 8:
                continue
            _, name, alias, iata, icao, _callsign, country, _active = row[:8]
            if icao and icao != r"\N" and len(icao) == 3:
                registry.setdefault(icao, []).append(
                    {"name": name, "alias": alias, "iata": iata, "country": country}
                )
    return registry


def normalise(text: str) -> set[str]:
    drop = {"airlines", "airline", "air", "lines", "international", "the", "royal",
            "group", "co", "ltd", "limited", "company", "dutch", "national"}
    words = "".join(c.lower() if c.isalnum() else " " for c in text).split()
    return {w for w in words if w not in drop and len(w) > 1}


def main() -> int:
    alliances = json.loads((DATA / "alliances.json").read_text(encoding="utf-8"))
    registry = load_registry()

    errors: list[str] = []
    notices: list[str] = []

    groups = dict(alliances["members"])
    groups["suspended"] = [
        {"name": a["name"], "icao": a["icao"], "iata": a["iata"]} for a in alliances["suspended"]
    ]

    seen: dict[str, str] = {}
    checked = 0

    for alliance_id, members in groups.items():
        for member in members:
            checked += 1
            icao, iata, name = member["icao"], member["iata"], member["name"]

            # --- structural: these must hold on their own terms ---
            if len(icao) != 3 or not icao.isalpha() or icao != icao.upper():
                errors.append(f"{name}: malformed ICAO code {icao!r}")
            if len(iata) != 2 or iata != iata.upper():
                errors.append(f"{name}: malformed IATA code {iata!r}")
            if icao in seen:
                errors.append(f"{icao} ({name}) appears in both {seen[icao]} and {alliance_id}")
            seen[icao] = alliance_id

            # --- advisory: agreement with a 2014 registry ---
            rows = registry.get(icao)
            if not rows:
                notices.append(f"{icao} {name}: absent from the 2014 registry")
                continue
            if not any(r["iata"] == iata for r in rows):
                found = ", ".join(sorted({r["iata"] for r in rows if r["iata"] != r"\N"}))
                notices.append(f"{icao} {name}: registry has IATA {found or '(none)'}, we have {iata}")
            ours = normalise(name)
            if not any(ours & (normalise(r["name"]) | normalise(r["alias"])) for r in rows):
                notices.append(
                    f"{icao} {name}: registry calls it {', '.join(sorted({r['name'] for r in rows}))}"
                )

    # --- current oracle: airlines actually observed flying ---
    routes_path = DATA / "routes.json"
    if routes_path.exists():
        observed = {
            a["icao"]: a
            for a in json.loads(routes_path.read_text(encoding="utf-8"))["airlines"]
            if a.get("icao")
        }
        matched = 0
        for members in groups.values():
            for member in members:
                live = observed.get(member["icao"])
                if not live:
                    continue
                matched += 1
                if live.get("iata") and live["iata"] != member["iata"]:
                    errors.append(
                        f"{member['icao']} {member['name']}: live data says IATA "
                        f"{live['iata']}, we have {member['iata']}"
                    )
        print(f"cross-checked {matched} alliance airlines against live observed data")
    else:
        print("routes.json not collected yet - skipping the live cross-check")

    print(f"checked {checked} airlines")
    star = len(alliances["members"]["star-alliance"])
    ow = len(alliances["members"]["oneworld"])
    st = len(alliances["members"]["skyteam"])
    print(f"  Star Alliance {star}   oneworld {ow}   SkyTeam {st}   suspended {len(alliances['suspended'])}")

    if notices:
        print(f"\n{len(notices)} notice(s) - stale-registry disagreements, not failures:")
        for notice in notices:
            print(f"  . {notice}")

    if errors:
        print(f"\n{len(errors)} ERROR(s):")
        for error in errors:
            print(f"  ! {error}")
        return 1

    print("\nno structural errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
