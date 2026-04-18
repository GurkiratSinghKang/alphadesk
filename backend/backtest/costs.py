"""Cost model protocol + Alpaca-based default implementation.

All costs are ``Decimal``. The engine calls :meth:`CostModel.commission`,
:meth:`CostModel.slippage`, and :meth:`CostModel.borrow_rate` around each
fill.

Default fee schedule:

* **Equities** -- zero commission (Alpaca).
* **Options** -- $0.01/share contract + $0.65 minimum ticket, regulatory
  fees capped at $1/contract for sells.
* **Slippage** -- ``impact_coef * (notional / adv_20d) + 0.5 * spread_pct``.
* **Borrow** -- ``borrow_rate`` annualised, per-ticker override dict supported.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Mapping, Optional, Protocol, runtime_checkable

from backtest.types import AssetClass, OptionLeg, Side


def _d(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


@runtime_checkable
class CostModel(Protocol):
    """Protocol every cost model must satisfy."""

    def commission(
        self,
        symbol: str,
        quantity: int,
        price: Decimal,
        asset_class: AssetClass,
        side: Side,
        legs: tuple[OptionLeg, ...] = (),
    ) -> Decimal:  # pragma: no cover
        ...

    def slippage(
        self,
        symbol: str,
        quantity: int,
        price: Decimal,
        adv_20d: Optional[Decimal] = None,
        spread_pct: Optional[Decimal] = None,
    ) -> Decimal:  # pragma: no cover
        ...

    def borrow_rate(self, symbol: str) -> Decimal:  # pragma: no cover
        ...


class DefaultCostModel:
    """Alpaca-style commission + simple linear slippage model."""

    def __init__(
        self,
        # Options: $0.01/contract per the spec; with $0.65 minimum ticket.
        option_per_contract: Decimal | float = Decimal("0.01"),
        option_min_ticket: Decimal | float = Decimal("0.65"),
        option_reg_fee_sell_per_contract: Decimal | float = Decimal("0.03"),
        option_reg_fee_cap_per_contract: Decimal | float = Decimal("1.00"),
        equity_per_share: Decimal | float = Decimal("0"),
        impact_coef: Decimal | float = Decimal("0.1"),
        default_spread_pct: Decimal | float = Decimal("0.0005"),  # 5 bps
        borrow_rate_default: Decimal | float = Decimal("0.01"),
        borrow_rate_overrides: Optional[Mapping[str, Decimal]] = None,
    ) -> None:
        self.option_per_contract = _d(option_per_contract)
        self.option_min_ticket = _d(option_min_ticket)
        self.option_reg_fee_sell_per_contract = _d(option_reg_fee_sell_per_contract)
        self.option_reg_fee_cap_per_contract = _d(option_reg_fee_cap_per_contract)
        self.equity_per_share = _d(equity_per_share)
        self.impact_coef = _d(impact_coef)
        self.default_spread_pct = _d(default_spread_pct)
        self.borrow_rate_default = _d(borrow_rate_default)
        self.borrow_rate_overrides: dict[str, Decimal] = (
            dict(borrow_rate_overrides) if borrow_rate_overrides else {}
        )

    # ------------------------------------------------------------------
    # Commission
    # ------------------------------------------------------------------

    def commission(
        self,
        symbol: str,
        quantity: int,
        price: Decimal,
        asset_class: AssetClass,
        side: Side,
        legs: tuple[OptionLeg, ...] = (),
    ) -> Decimal:
        qty = abs(int(quantity))
        if qty == 0:
            return Decimal("0")

        if asset_class is AssetClass.EQUITY:
            return self.equity_per_share * Decimal(qty)

        if asset_class in (AssetClass.OPTION, AssetClass.MULTILEG):
            total_contracts = (
                sum(abs(leg.qty) for leg in legs) * qty if legs else qty
            )
            # Per-contract charge, with a per-ticket minimum.
            commission = self.option_per_contract * Decimal(total_contracts)
            if commission < self.option_min_ticket:
                commission = self.option_min_ticket

            # Regulatory fees on sells (capped at $1/contract).
            is_sell = side is Side.SELL or any(
                leg.side is Side.SELL for leg in legs
            )
            if is_sell:
                sell_contracts = (
                    sum(abs(leg.qty) for leg in legs if leg.side is Side.SELL)
                    * qty
                    if legs
                    else qty
                )
                reg = self.option_reg_fee_sell_per_contract * Decimal(
                    sell_contracts
                )
                cap = self.option_reg_fee_cap_per_contract * Decimal(
                    sell_contracts
                )
                if reg > cap:
                    reg = cap
                commission += reg
            return commission

        return Decimal("0")

    # ------------------------------------------------------------------
    # Slippage
    # ------------------------------------------------------------------

    def slippage(
        self,
        symbol: str,
        quantity: int,
        price: Decimal,
        adv_20d: Optional[Decimal] = None,
        spread_pct: Optional[Decimal] = None,
    ) -> Decimal:
        """Return dollar slippage on a fill.

        ``impact_coef * (trade_notional / adv_20d) + 0.5 * spread_pct`` times
        the notional. ``adv_20d`` is the 20-day dollar ADV; when ``None`` we
        assume a market-impact term of zero (providers with no ADV data).
        """

        qty = abs(int(quantity))
        if qty == 0 or price <= 0:
            return Decimal("0")
        notional = Decimal(qty) * price

        impact = Decimal("0")
        if adv_20d is not None and _d(adv_20d) > 0:
            impact = self.impact_coef * (notional / _d(adv_20d))

        spread = _d(spread_pct) if spread_pct is not None else self.default_spread_pct
        half_spread = Decimal("0.5") * spread

        return notional * (impact + half_spread)

    # ------------------------------------------------------------------
    # Borrow
    # ------------------------------------------------------------------

    def borrow_rate(self, symbol: str) -> Decimal:
        return self.borrow_rate_overrides.get(symbol, self.borrow_rate_default)


__all__ = ["CostModel", "DefaultCostModel"]
