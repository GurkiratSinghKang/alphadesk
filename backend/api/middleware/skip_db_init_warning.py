"""Middleware that flags responses when the DB is deliberately un-initialised.

When the ``SKIP_DB_INIT`` setting is True, many routes short-circuit and
return an empty list rather than querying the database. Previously this was
invisible to clients — a genuinely empty result and a skipped-DB result both
looked like ``[]``. This middleware makes the degraded mode discoverable by
injecting ``X-Alphadesk-Warning`` on every response, and the main lifespan
hook logs a single warning at startup for oncall visibility.
"""
from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("alphadesk.middleware")

SKIP_DB_INIT_WARNING_HEADER = "X-Alphadesk-Warning"
SKIP_DB_INIT_WARNING_VALUE = "db-skipped; results may be empty"


class SkipDbInitWarningMiddleware(BaseHTTPMiddleware):
    """Inject a warning header whenever ``settings.SKIP_DB_INIT`` is truthy."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response: Response = await call_next(request)
        try:
            from core.config import settings
            if getattr(settings, "SKIP_DB_INIT", False):
                response.headers[SKIP_DB_INIT_WARNING_HEADER] = SKIP_DB_INIT_WARNING_VALUE
        except Exception:
            # Never let a header-injection failure mask the real response.
            logger.debug(
                "skip_db_init_warning: failed to inject warning header",
                exc_info=True,
            )
        return response
