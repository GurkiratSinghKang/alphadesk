"""Disk-usage monitor (Wave 4R Fix 8).

No disk monitoring existed before this script. The VPS has a single root
filesystem; when ``/var/lib/alphadesk`` fills up (pipeline logs,
backups that missed their rclone window, Docker overlay), Postgres
refuses new writes and the trading pipeline starts rejecting orders at
submission time with no advance warning. This script:

1. Reads :func:`shutil.disk_usage` for a given path (default
   ``/var/lib/alphadesk`` — the volume the compose file mounts backups
   and pipeline_logs into).
2. Emits a WARN log line and an ``audit_log`` entry when the used
   percentage crosses the alert threshold (default 85 %).
3. Exits 0 when healthy, 1 when over the threshold, 2 on I/O errors.

The ``/readyz`` endpoint consults the same threshold to return a
``degraded`` body at > 90 % — see :func:`backend.main.readyz`.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import shutil
import sys
from typing import Any

logger = logging.getLogger("alphadesk.disk_check")


def disk_usage_pct(path: str) -> float:
    """Return the percentage (0-100) of ``path``'s filesystem currently in use.

    Thin wrapper around :func:`shutil.disk_usage` so tests can patch this
    out without needing a writable tmpfs.
    """
    usage = shutil.disk_usage(path)
    if usage.total == 0:
        return 0.0
    return (usage.used / usage.total) * 100.0


async def _write_audit(event: str, details: dict[str, Any]) -> None:
    try:
        from core.audit import write_audit

        await write_audit(
            event,
            username=None,
            ip=None,
            request_id=None,
            details=details,
        )
    except Exception:
        logger.warning("audit write failed for event=%s", event, exc_info=True)


async def check_once(
    path: str = "/var/lib/alphadesk",
    warn_pct: float = 85.0,
    degraded_pct: float = 90.0,
) -> int:
    """Run one check. Returns POSIX exit code."""
    try:
        pct = disk_usage_pct(path)
    except Exception as exc:
        logger.error("disk check failed for %s: %s", path, exc)
        await _write_audit(
            "disk_check_error",
            {"path": path, "error": str(exc), "error_type": type(exc).__name__},
        )
        return 2

    usage = shutil.disk_usage(path)
    details = {
        "path": path,
        "used_pct": round(pct, 2),
        "used_gb": round(usage.used / (1024**3), 2),
        "total_gb": round(usage.total / (1024**3), 2),
        "free_gb": round(usage.free / (1024**3), 2),
        "warn_threshold_pct": warn_pct,
        "degraded_threshold_pct": degraded_pct,
    }

    if pct >= degraded_pct:
        logger.error(
            "DISK CRITICAL for %s: %.1f%% used (>= %.0f%% degraded threshold)",
            path, pct, degraded_pct,
        )
        await _write_audit("disk_critical", details)
        return 1
    if pct >= warn_pct:
        logger.warning(
            "DISK WARN for %s: %.1f%% used (>= %.0f%% warn threshold)",
            path, pct, warn_pct,
        )
        await _write_audit("disk_warn", details)
        return 0  # Still a valid exit — warn is logged + audited.
    logger.info("disk ok for %s: %.1f%% used", path, pct)
    return 0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check disk usage for AlphaDesk.")
    parser.add_argument(
        "--path",
        default=os.environ.get("ALPHADESK_DATA_DIR", "/var/lib/alphadesk"),
        help="Filesystem path to monitor (default: $ALPHADESK_DATA_DIR or /var/lib/alphadesk).",
    )
    parser.add_argument(
        "--warn-pct", type=float, default=85.0,
        help="Log a WARN + audit entry when usage is at or above this pct (default: 85).",
    )
    parser.add_argument(
        "--degraded-pct", type=float, default=90.0,
        help="Report degraded state at or above this pct (default: 90).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args(argv)
    return asyncio.run(
        check_once(args.path, warn_pct=args.warn_pct, degraded_pct=args.degraded_pct)
    )


if __name__ == "__main__":
    sys.exit(main())
