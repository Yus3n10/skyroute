"""CognoDB connection lifecycle.

CognoDB speaks openCypher over Bolt, so the official Neo4j async driver talks to it
unchanged. Everything the app does against the database goes through `run()` here,
which gives us exactly one place to translate driver failures into a single
application-level error the API layer can turn into a 503.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase
from neo4j.exceptions import AuthError, Neo4jError, ServiceUnavailable

log = logging.getLogger("punishlab.db")

_driver: AsyncDriver | None = None


class DatabaseUnavailable(RuntimeError):
    """The graph could not be reached or the query could not be served."""


def _config() -> tuple[str, str, str]:
    uri = os.getenv("COGNODB_URI")
    password = os.getenv("COGNODB_PASSWORD")
    user = os.getenv("COGNODB_USER", "cognodb")
    missing = [n for n, v in (("COGNODB_URI", uri), ("COGNODB_PASSWORD", password)) if not v]
    if missing:
        raise DatabaseUnavailable(
            f"Missing environment variable(s): {', '.join(missing)}. "
            "Copy .env.example to .env and fill in your CognoDB instance details."
        )
    return uri, user, password  # type: ignore[return-value]


async def connect() -> None:
    """Open the pooled driver. Never raises.

    This function's whole contract is that a database problem must not stop the
    process from starting - a container that crash-loops cannot tell anyone why it
    is unhappy, while a running one serves a truthful 503 that names the cause.

    The catch is deliberately broad. Driver failures are not limited to the tidy
    Neo4jError hierarchy: an unresolvable hostname surfaces as a bare ValueError
    from DNS resolution, and a malformed URI as a plain ConfigurationError. Listing
    exception types here means the next unlisted one takes the process down, which
    is exactly the outcome this function exists to prevent.

    The driver is only published to the module global after connectivity is
    verified, so `run()` can never pick up a half-built driver.
    """
    global _driver
    if _driver is not None:
        return

    candidate: AsyncDriver | None = None
    try:
        uri, user, password = _config()
        candidate = AsyncGraphDatabase.driver(
            uri,
            auth=(user, password),
            max_connection_pool_size=int(os.getenv("COGNODB_MAX_POOL_SIZE", "20")),
            connection_acquisition_timeout=15,
        )
        await candidate.verify_connectivity()
    except Exception as exc:
        log.error("CognoDB unavailable at startup: %s: %s", type(exc).__name__, exc)
        if candidate is not None:
            try:
                await candidate.close()
            except Exception:  # noqa: BLE001 - nothing useful to do while cleaning up
                pass
        return

    _driver = candidate
    log.info("connected to CognoDB")


async def close() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def run(cypher: str, **params: Any) -> list[dict[str, Any]]:
    """Run one parameterised read query and return plain dicts.

    Parameters are always passed through the driver as `$name` bindings. No caller
    builds Cypher by concatenating user input - see queries.py for the one place
    where query text varies, and how it is kept off the user-input path.
    """
    if _driver is None:
        await connect()
    if _driver is None:
        raise DatabaseUnavailable(
            "No connection to CognoDB. Check COGNODB_URI / COGNODB_PASSWORD and that "
            "the instance is running."
        )
    try:
        records, _, _ = await _driver.execute_query(cypher, params, database_="neo4j")
        return [r.data() for r in records]
    except (ServiceUnavailable, AuthError) as exc:
        raise DatabaseUnavailable(f"CognoDB is unreachable: {exc}") from exc
    except Neo4jError as exc:
        log.exception("query failed")
        raise DatabaseUnavailable(f"Query rejected by CognoDB: {exc.message}") from exc
    except Exception as exc:
        # Same reasoning as connect(): anything the driver throws that is not in the
        # Neo4jError hierarchy still means "this request cannot be served", and the
        # caller only knows how to handle DatabaseUnavailable.
        log.exception("unexpected driver failure")
        raise DatabaseUnavailable(f"CognoDB request failed: {type(exc).__name__}: {exc}") from exc


async def healthy() -> bool:
    try:
        await run("RETURN 1 AS ok")
        return True
    except DatabaseUnavailable:
        return False
