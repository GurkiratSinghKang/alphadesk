"""Supervised asyncio task helper.

Round-11 / BB-13 (P0): roughly nine ``asyncio.create_task(...)`` call
sites across the backend never attached a ``done_callback`` to log
exceptions raised inside the task. If the task's outer ``try/except``
loop is bypassed (a future refactor drops the ``except``, a
``BaseException`` like ``MemoryError`` slips through, the coroutine
returns instead of looping forever) the task silently terminates and
the scheduler / scanner / reconciler stops doing its job. There is
no operator signal — the next pipeline simply doesn't fire.

This module gives every long-running supervised task one entry-point
that consumes ``task.exception()`` on completion and logs at ``ERROR``
so the operator sees the death.

Usage::

    from core.supervised_task import create_supervised_task

    create_supervised_task(_scheduler_loop(), name="pipeline_scheduler")
    create_supervised_task(_alpaca_consumer(), name="alpaca_ws")

The returned ``Task`` is identical to ``asyncio.create_task``'s return
value — callers can still call ``.cancel()`` on it.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Coroutine

logger = logging.getLogger("alphadesk.supervised_task")


def _on_done(task: "asyncio.Task[Any]", *, name: str) -> None:
    """Log any exception raised by the supervised task.

    Cancellation is not an error — operators expect to be able to
    cancel background tasks during shutdown. Any other exception is
    a real death and gets surfaced at ERROR with the traceback.
    """
    if task.cancelled():
        logger.info("Supervised task %s cancelled cleanly", name)
        return
    exc = task.exception()
    if exc is None:
        logger.info("Supervised task %s completed cleanly", name)
        return
    logger.error(
        "Supervised task %s died with %s — background work has stopped",
        name,
        type(exc).__name__,
        exc_info=exc,
    )


def create_supervised_task(
    coro: Coroutine[Any, Any, Any],
    *,
    name: str,
) -> "asyncio.Task[Any]":
    """Schedule ``coro`` and attach a death-logger callback.

    Always prefer this over a bare ``asyncio.create_task(...)`` for
    long-running supervisor / consumer / reconciler tasks. The named
    callback ensures a silent-death of the task is visible in the
    structured logs immediately, instead of waiting for the next
    "why didn't the pipeline run today?" oncall question.
    """
    task = asyncio.create_task(coro, name=name)
    task.add_done_callback(lambda t: _on_done(t, name=name))
    return task


__all__ = ["create_supervised_task"]
