"""B.3 — Multi-list watchlists v2.

Replaces the single-row UserWatchlist with multiple named lists per
user (manual + auto_strategy + auto_earnings) with optional sharing.

Endpoints:
  GET    /api/v1/watchlists                       (list + items inline)
  POST   /api/v1/watchlists                       (create)
  PATCH  /api/v1/watchlists/{id}                  (rename / share)
  DELETE /api/v1/watchlists/{id}                  (drop list)
  POST   /api/v1/watchlists/{id}/items            (add symbol)
  DELETE /api/v1/watchlists/{id}/items/{symbol}   (remove symbol)
"""
from __future__ import annotations

import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete

from api.routes.auth import require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/watchlists", tags=["watchlists-v2"])


class WatchlistItemOut(BaseModel):
    symbol: str
    position: int = 0
    note: str | None = None


class WatchlistOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    kind: str
    auto_source_strategy: str | None = None
    column_set: list[str] | None = None
    share_mode: str
    share_token: str | None = None
    position: int
    items: list[WatchlistItemOut] = []


class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    kind: Literal["manual", "auto_strategy", "auto_earnings"] = "manual"
    auto_source_strategy: str | None = None
    column_set: list[str] | None = None


class WatchlistPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    column_set: list[str] | None = None
    share_mode: Literal["private", "tenant", "public"] | None = None
    position: int | None = None


class WatchlistItemAdd(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=500)


def _items_to_out(items) -> list[WatchlistItemOut]:
    return [
        WatchlistItemOut(
            symbol=row.symbol,
            position=int(row.position or 0),
            note=row.note,
        )
        for row in items
    ]


def _row_to_out(row, items=()) -> WatchlistOut:
    return WatchlistOut(
        id=int(row.id),
        name=row.name,
        description=row.description,
        kind=row.kind,
        auto_source_strategy=row.auto_source_strategy,
        column_set=row.column_set if row.column_set else None,
        share_mode=row.share_mode,
        share_token=row.share_token,
        position=int(row.position or 0),
        items=_items_to_out(items),
    )


@router.get("", response_model=list[WatchlistOut])
async def list_watchlists(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[WatchlistOut]:
    from data.storage.models import Watchlist, WatchlistItem

    result = await db.execute(
        select(Watchlist)
        .where(Watchlist.username == username)
        .order_by(Watchlist.position.asc(), Watchlist.id.asc())
    )
    lists = result.scalars().all()
    out: list[WatchlistOut] = []
    for wl in lists:
        items_res = await db.execute(
            select(WatchlistItem)
            .where(WatchlistItem.watchlist_id == wl.id)
            .order_by(WatchlistItem.position.asc(), WatchlistItem.id.asc())
        )
        out.append(_row_to_out(wl, items_res.scalars().all()))
    return out


@router.post("", response_model=WatchlistOut, status_code=status.HTTP_201_CREATED)
async def create_watchlist(
    payload: WatchlistCreate,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> WatchlistOut:
    from data.storage.models import Watchlist

    row = Watchlist(
        username=username,
        name=payload.name,
        description=payload.description,
        kind=payload.kind,
        auto_source_strategy=payload.auto_source_strategy,
        column_set=payload.column_set,
        share_mode="private",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="watchlist_created",
        username=username,
        ip=None,
        request_id=None,
        details={"watchlist_id": row.id, "name": payload.name, "kind": payload.kind},
    )
    return _row_to_out(row, [])


@router.patch("/{watchlist_id}", response_model=WatchlistOut)
async def patch_watchlist(
    watchlist_id: int,
    payload: WatchlistPatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> WatchlistOut:
    from data.storage.models import Watchlist, WatchlistItem

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_id, Watchlist.username == username
        )
    )
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")
    changed: dict = {}
    if payload.name is not None and payload.name != row.name:
        row.name = payload.name
        changed["name"] = payload.name
    if payload.description is not None:
        row.description = payload.description
        changed["description"] = payload.description
    if payload.column_set is not None:
        row.column_set = payload.column_set
        changed["column_set"] = payload.column_set
    if payload.share_mode is not None and payload.share_mode != row.share_mode:
        row.share_mode = payload.share_mode
        if payload.share_mode == "private":
            row.share_token = None
        elif row.share_token is None:
            row.share_token = secrets.token_urlsafe(32)
        changed["share_mode"] = payload.share_mode
    if payload.position is not None:
        row.position = payload.position
        changed["position"] = payload.position
    if changed:
        await db.commit()
        await db.refresh(row)
        await write_audit(
            event="watchlist_patched",
            username=username,
            ip=None,
            request_id=None,
            details={"watchlist_id": watchlist_id, "changes": changed},
        )
    items_res = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.watchlist_id == watchlist_id)
        .order_by(WatchlistItem.position.asc(), WatchlistItem.id.asc())
    )
    return _row_to_out(row, items_res.scalars().all())


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist(
    watchlist_id: int,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> None:
    from data.storage.models import Watchlist, WatchlistItem

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.id == watchlist_id, Watchlist.username == username
        )
    )
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")
    await db.execute(delete(WatchlistItem).where(WatchlistItem.watchlist_id == watchlist_id))
    await db.delete(row)
    await db.commit()
    await write_audit(
        event="watchlist_deleted",
        username=username,
        ip=None,
        request_id=None,
        details={"watchlist_id": watchlist_id},
    )


@router.post("/{watchlist_id}/items", response_model=WatchlistItemOut, status_code=status.HTTP_201_CREATED)
async def add_item(
    watchlist_id: int,
    payload: WatchlistItemAdd,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> WatchlistItemOut:
    from data.storage.models import Watchlist, WatchlistItem

    wl = (
        await db.execute(
            select(Watchlist).where(
                Watchlist.id == watchlist_id, Watchlist.username == username
            )
        )
    ).scalars().first()
    if wl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")

    sym = payload.symbol.upper().strip()
    existing = (
        await db.execute(
            select(WatchlistItem).where(
                WatchlistItem.watchlist_id == watchlist_id,
                WatchlistItem.symbol == sym,
            )
        )
    ).scalars().first()
    if existing:
        return WatchlistItemOut(symbol=existing.symbol, position=existing.position, note=existing.note)

    row = WatchlistItem(
        watchlist_id=watchlist_id,
        symbol=sym,
        note=payload.note,
        position=0,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return WatchlistItemOut(symbol=row.symbol, position=row.position, note=row.note)


@router.delete("/{watchlist_id}/items/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_item(
    watchlist_id: int,
    symbol: str,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> None:
    from data.storage.models import Watchlist, WatchlistItem

    wl = (
        await db.execute(
            select(Watchlist).where(
                Watchlist.id == watchlist_id, Watchlist.username == username
            )
        )
    ).scalars().first()
    if wl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")

    await db.execute(
        delete(WatchlistItem).where(
            WatchlistItem.watchlist_id == watchlist_id,
            WatchlistItem.symbol == symbol.upper(),
        )
    )
    await db.commit()


# ---- GET /{id}/enriched — items joined with current quotes + signals ----
#
# Powers the design's watchlists table by returning per-symbol live
# data (price, day %, vol, signal) the bare items endpoint can't
# supply. Frontend uses this to swap MOCK_WATCHLISTS for live data
# without a per-row fan-out of quote queries.

class EnrichedItem(BaseModel):
    symbol: str
    name: str | None = None
    px: float | None = None
    pct_day: float | None = None
    vol: str | None = None
    tech_score: int | None = None
    signal: str | None = None
    held: bool = False
    note: str | None = None
    position: int = 0


class EnrichedWatchlistResponse(BaseModel):
    id: int
    name: str
    kind: str
    items: list[EnrichedItem] = []


@router.get("/{watchlist_id}/enriched", response_model=EnrichedWatchlistResponse)
async def get_enriched_watchlist(
    watchlist_id: int,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> EnrichedWatchlistResponse:
    """Return a watchlist's items joined with current quote + signal data.

    For each symbol in the list, looks up:
      - name (from the symbols catalogue)
      - px / pct_day (from the latest quote feed; null when unavailable)
      - vol (formatted volume string)
      - tech_score (placeholder 0-100; will swap to real factor score
        once backend B.X exposes per-symbol momentum + value scores)
      - signal (current pipeline signal if any, else "neutral")
      - held (true when symbol is in the operator's open positions)

    Falls back to symbol-only data when the auxiliary feeds are
    unavailable so the table renders even on a cold backend.
    """
    from data.storage.models import Watchlist, WatchlistItem

    wl = (
        await db.execute(
            select(Watchlist).where(
                Watchlist.id == watchlist_id, Watchlist.username == username
            )
        )
    ).scalars().first()
    if wl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")

    items_res = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.watchlist_id == watchlist_id)
        .order_by(WatchlistItem.position.asc(), WatchlistItem.symbol.asc())
    )
    items = items_res.scalars().all()

    # Build a name lookup once from the local symbol catalogue.
    name_by_symbol: dict[str, str] = {}
    try:
        from api.routes.symbols import _build_demo_symbols
        for s in _build_demo_symbols():
            name_by_symbol[s.symbol] = s.name
    except Exception:
        pass

    # Held lookup — symbols currently in the operator's open positions.
    held_set: set[str] = set()
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()
        for pos in ledger.get_open_positions():
            sym = pos.get("symbol")
            if sym:
                held_set.add(str(sym).upper())
    except Exception:
        pass

    # Quote feed — call the shared snapshot resolver per symbol.
    # Bounded to the symbols on this list (typically 5-50) so the
    # extra calls stay in budget. Polygon → Alpaca → demo waterfall
    # is handled inside _fetch_snapshot_impl.
    snapshot_by_symbol: dict[str, Any] = {}
    try:
        from api.routes.market import _fetch_snapshot_impl
        for it in items:
            sym = it.symbol.upper()
            try:
                snap = await _fetch_snapshot_impl(sym)
                snapshot_by_symbol[sym] = snap
            except Exception:
                # Per-symbol failures are non-fatal — the row just
                # renders px/pct_day as null on the frontend.
                continue
    except Exception:
        # Whole-feed unavailable — every row falls back to bare data.
        pass

    def _format_volume(n: float | int | None) -> str | None:
        if n is None or n == 0:
            return None
        n_int = int(n)
        if n_int >= 1_000_000_000:
            return f"{n_int / 1_000_000_000:.1f}B"
        if n_int >= 1_000_000:
            return f"{n_int / 1_000_000:.1f}M"
        if n_int >= 1_000:
            return f"{n_int / 1_000:.1f}K"
        return str(n_int)

    enriched: list[EnrichedItem] = []
    for it in items:
        sym = it.symbol.upper()
        snap = snapshot_by_symbol.get(sym)
        px: float | None = None
        pct_day: float | None = None
        vol: str | None = None
        if snap is not None:
            try:
                px = float(snap.day_bar.close) if snap.day_bar else None
            except Exception:
                px = None
            try:
                pct_day = float(snap.change_pct) if snap.change_pct is not None else None
            except Exception:
                pct_day = None
            try:
                vol = _format_volume(snap.day_bar.volume) if snap.day_bar else None
            except Exception:
                vol = None
        enriched.append(
            EnrichedItem(
                symbol=sym,
                name=name_by_symbol.get(sym),
                px=px,
                pct_day=pct_day,
                vol=vol,
                tech_score=None,   # placeholder — needs a factor-score endpoint
                signal=None,       # placeholder — needs pipeline-signal-by-symbol lookup
                held=sym in held_set,
                note=it.note,
                position=int(it.position or 0),
            )
        )

    return EnrichedWatchlistResponse(
        id=int(wl.id),
        name=wl.name,
        kind=wl.kind,
        items=enriched,
    )
