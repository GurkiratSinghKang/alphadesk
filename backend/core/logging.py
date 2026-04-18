"""Centralised logging configuration for AlphaDesk.

Public API:
- ``REQUEST_ID``: ContextVar holding the current request's X-Request-ID (or "-"
  when outside a request). Populated by the request-id middleware in
  ``main.py`` and read by the ``JsonFormatter`` so every log line emitted
  during a request carries the same id — makes end-to-end tracing possible
  (middleware -> handler -> DB -> Alpaca, one grep).
- ``configure_logging(level=None, json_mode=None)``: idempotent bootstrap
  called once at startup from ``main.py``. Replaces whatever Gunicorn set up,
  installs the JSON formatter on a single ``StreamHandler`` at the root, and
  pins the level on the ``alphadesk`` namespace plus a few first-party
  sub-namespaces.
- ``JsonFormatter``: minimal ``logging.Formatter`` subclass emitting one
  JSON object per line. No new dependency — uses the stdlib ``json`` module.
  Fields: ``timestamp, level, message, logger, request_id`` always; plus any
  of ``user, path, method`` that were attached via ``extra=`` on the log
  call.

Rationale (see audit-reports/observability-audit-r4.md P0 #3, P0 #4):
previously main.py used ``logging.basicConfig`` with a pipe-delimited format
string that carried zero structured data. Log aggregators (Loki / Cloudwatch
/ Datadog) can't filter by ``request_id=...`` unless each record has a
dedicated field — hence this module.
"""
from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

# Request-scoped correlation id. Set by the request-id middleware. Default to
# "-" so background tasks and startup logs don't crash the formatter.
REQUEST_ID: ContextVar[str] = ContextVar("request_id", default="-")


# Fields on LogRecord that belong to the stdlib and should never be written
# as structured extras. Used by JsonFormatter to distinguish caller-provided
# ``extra=`` fields from the record's built-ins.
_STD_LOGRECORD_ATTRS = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "taskName",
        "message",
        "asctime",
    }
)


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record.

    Always-present keys: ``timestamp`` (ISO-8601 UTC), ``level``, ``message``,
    ``logger``, ``request_id``. Any kwargs passed via
    ``logger.info("msg", extra={"user": "...", "path": "..."})`` are merged
    into the object as top-level keys.

    Exceptions (``exc_info=True`` or ``logger.exception``) are rendered into
    a ``stack`` field so they remain queryable alongside the rest.
    """

    def format(self, record: logging.LogRecord) -> str:
        # ``record.getMessage()`` applies %-args to the format string; the
        # result is the human-readable message, same as stdlib would write.
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "request_id": REQUEST_ID.get(),
        }

        # Merge any caller-supplied extras (user, path, method, event, etc.).
        # LogRecord stashes them as instance attributes alongside stdlib ones,
        # so filter by name.
        for key, value in record.__dict__.items():
            if key in _STD_LOGRECORD_ATTRS or key.startswith("_"):
                continue
            if key in payload:
                # Don't let an ``extra={"level": ...}`` clobber the real level.
                continue
            payload[key] = value

        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)
        elif record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        # default=str so datetime / Decimal / UUID extras don't blow up the
        # formatter mid-log. Worst case we stringify an object; better than
        # raising inside logging.
        return json.dumps(payload, default=str, ensure_ascii=False)


_CONFIGURED = False


def configure_logging(level: str | int | None = None, json_mode: bool = True) -> None:
    """Install the JSON formatter on the root logger.

    Idempotent — safe to call from multiple entrypoints (main lifespan, tests).
    ``level`` accepts either a string ("INFO") or an int (logging.INFO). When
    None we read ``settings.LOG_LEVEL`` to preserve the current behaviour.

    ``json_mode=False`` falls back to the old pipe-delimited format — useful
    for local development where a pair of eyes is easier than a JSON parser.
    """
    global _CONFIGURED

    # Resolve level — stays compatible with how main.py used to read it.
    if level is None:
        from core.config import settings  # local import: avoid import cycle on module load
        level = settings.LOG_LEVEL
    if isinstance(level, str):
        level = getattr(logging, level.upper(), logging.INFO)

    if json_mode:
        formatter: logging.Formatter = JsonFormatter()
    else:
        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
        )

    # Reset the root so Gunicorn's pre-installed handlers don't double-emit.
    # ``force=True`` behaviour without calling basicConfig.
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(formatter)
    handler.setLevel(level)
    root.addHandler(handler)
    root.setLevel(level)

    # Pin first-party namespaces. They currently rely on propagation to root,
    # but some call sites install their own handlers; zeroing those out here
    # keeps the output stream single-source-of-truth.
    for name in ("alphadesk", "alphadesk.audit", "data.ingestion", "api", "api.websocket", "core"):
        lg = logging.getLogger(name)
        lg.setLevel(level)
        # Drop any handler that was added by the old main.py bootstrap block.
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.propagate = True

    _CONFIGURED = True
