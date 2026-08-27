"""SkyRoute HTTP API.

Layering is deliberately flat: this module does request/response work only.
Cypher lives in queries.py, connection handling lives in db.py. Nothing here
touches the driver directly.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

from . import db, queries  # noqa: E402  (import after load_dotenv so env is populated)

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    yield
    await db.close()


app = FastAPI(
    title="SkyRoute API",
    description="The live airline route network as a graph: airports, airlines, alliances.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(db.DatabaseUnavailable)
async def _db_down(_: Request, exc: db.DatabaseUnavailable) -> JSONResponse:
    """Every database failure becomes one honest 503 the UI knows how to render."""
    return JSONResponse(
        status_code=503,
        content={
            "error": "database_unavailable",
            "detail": str(exc),
            "hint": "Confirm the CognoDB instance is running and COGNODB_* env vars are set.",
        },
    )


@app.exception_handler(ValueError)
async def _bad_value(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": "invalid_request", "detail": str(exc)})


class ItineraryRequest(BaseModel):
    origin: str = Field(min_length=3, max_length=3)
    destination: str = Field(min_length=3, max_length=3)
    maxLegs: int = Field(default=2, ge=queries.MIN_LEGS, le=queries.MAX_LEGS)
    alliance: str | None = Field(default=None, max_length=30)
    limit: int = Field(default=20, ge=1, le=50)


@app.get("/api/health")
async def health() -> dict:
    ok = await db.healthy()
    return {"status": "ok" if ok else "degraded", "database": "up" if ok else "down"}


@app.get("/api/stats")
async def stats() -> dict:
    return await queries.stats()


@app.get("/api/airlines")
async def airlines() -> list[dict]:
    return await queries.all_airlines()


@app.get("/api/alliances")
async def alliances() -> list[dict]:
    return await queries.alliances()


@app.get("/api/alliances/{alliance_id}/airlines")
async def alliance_airlines(alliance_id: str) -> list[dict]:
    if alliance_id not in queries.ALLIANCE_IDS:
        raise HTTPException(404, f"Unknown alliance '{alliance_id}'.")
    return await queries.airlines_for_alliance(alliance_id)


@app.get("/api/hubs")
async def hubs(limit: int = Query(default=25, ge=1, le=100)) -> list[dict]:
    return await queries.hubs(limit)


@app.get("/api/airports/search")
async def search(
    q: str = Query(min_length=1, max_length=60),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[dict]:
    rows = await queries.search_airports(q, limit)
    return [r["airport"] for r in rows]


@app.get("/api/airports/{iata}")
async def airport(iata: str) -> dict:
    detail = await queries.airport(iata)
    if detail is None:
        raise HTTPException(404, f"Airport '{iata.upper()}' is not in the graph.")
    return detail


@app.get("/api/airports/{iata}/destinations")
async def destinations(iata: str) -> list[dict]:
    if await queries.airport(iata) is None:
        raise HTTPException(404, f"Airport '{iata.upper()}' is not in the graph.")
    return await queries.destinations_from(iata)


@app.get("/api/airports/{iata}/reach")
async def reach(iata: str, legs: int = Query(default=2, ge=1, le=queries.MAX_LEGS)) -> list[dict]:
    if await queries.airport(iata) is None:
        raise HTTPException(404, f"Airport '{iata.upper()}' is not in the graph.")
    return await queries.reach(iata, legs)


@app.post("/api/itineraries")
async def itineraries(body: ItineraryRequest) -> dict:
    origin = await queries.airport(body.origin)
    destination = await queries.airport(body.destination)
    if origin is None:
        raise HTTPException(404, f"Airport '{body.origin.upper()}' is not in the graph.")
    if destination is None:
        raise HTTPException(404, f"Airport '{body.destination.upper()}' is not in the graph.")
    if body.origin.upper() == body.destination.upper():
        raise HTTPException(422, "Origin and destination are the same airport.")

    found = await queries.itineraries(
        body.origin, body.destination, body.maxLegs, body.alliance, body.limit
    )
    return {
        "origin": origin["airport"],
        "destination": destination["airport"],
        "itineraries": found,
    }


@app.get("/api/itineraries/alliances")
async def compare_alliances(
    origin: str = Query(min_length=3, max_length=3),
    destination: str = Query(min_length=3, max_length=3),
    legs: int = Query(default=2, ge=queries.MIN_LEGS, le=queries.MAX_LEGS),
) -> list[dict]:
    return await queries.alliance_comparison(origin, destination, legs)


@app.get("/api/itineraries/fewest-stops")
async def fewest(
    origin: str = Query(min_length=3, max_length=3),
    destination: str = Query(min_length=3, max_length=3),
) -> dict:
    rows = await queries.fewest_stops(origin, destination)
    return {"route": rows[0] if rows else None}


# --- Static frontend ---------------------------------------------------------
# The built React app is served by the same process, so the deployment is one
# service with one URL and no CORS configuration to get wrong.

if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
else:
    @app.get("/")
    async def no_build() -> dict:
        return {
            "message": "API is up. The frontend has not been built yet.",
            "build": "cd web && npm install && npm run build",
            "docs": "/docs",
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
