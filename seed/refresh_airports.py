"""Refresh data/airports.csv from OurAirports.

    python -m seed.refresh_airports

OurAirports regenerates daily upstream and ships ~86,000 rows, most of them
heliports and airstrips with no IATA code that this application can never
reference. Trimming to IATA-coded rows and the columns actually read takes the
file from about 13 MB to under 1 MB, which is the difference between a repo you
can clone quickly and one you cannot.
"""
from __future__ import annotations

import csv
import io
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv"
COUNTRIES = "https://davidmegginson.github.io/ourairports-data/countries.csv"
DATA = Path(__file__).resolve().parent / "data"

COLUMNS = ["iata_code", "icao_code", "ident", "name", "municipality", "iso_country",
           "continent", "latitude_deg", "longitude_deg", "type", "scheduled_service"]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "skyroute-graph/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8", errors="replace")


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)

    raw = fetch(SOURCE)
    target = DATA / "airports.csv"
    kept = 0
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for row in csv.DictReader(io.StringIO(raw)):
            if len((row.get("iata_code") or "").strip()) != 3:
                continue
            writer.writerow({c: (row.get(c) or "").strip() for c in COLUMNS})
            kept += 1
    print(f"wrote {target.name}: {kept} airports with IATA codes "
          f"({target.stat().st_size / 1e6:.2f} MB)")

    countries = DATA / "ourairports-countries.csv"
    countries.write_text(fetch(COUNTRIES), encoding="utf-8")
    print(f"wrote {countries.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
