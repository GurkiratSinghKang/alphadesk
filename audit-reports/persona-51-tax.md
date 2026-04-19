# Persona 51 — US Tax Accountant / 1099-B Equivalent Review

**Reviewer:** US tax accountant preparing Form 8949 / Schedule D
**Scope:** `frontend/src/app/(dashboard)/reports/page.tsx` (TaxReport), `backend/data/ingestion/trade_ledger.py`, `backend/data/storage/models.py` (Trade), `backend/api/routes/trades.py` (`/history`)
**Verdict:** NOT a 1099-B. Output is a directional P&L estimate, not a tax-compliant statement. Ten material gaps below.

## Findings

### 1. No wash-sale detection anywhere in the codebase (CRITICAL)
Grep for `wash_sale`, `washsale`, `wash.sale` returns zero hits in `backend/` and `frontend/`. IRS §1091 disallows losses on securities repurchased within 30 days (before or after) the loss sale. AlphaDesk strategies (RSI2 reversal, ORB, mean-reversion) trade the same symbols repeatedly and **will routinely generate disallowed losses** that the Tax Report still counts as deductible. Exported CSV cannot be used as Form 8949 without manual wash-sale overlay. Needs a lot-level wash-sale engine with 30-day lookback/lookforward across all accounts.

### 2. No cost-basis lot tracking — uses single `entry_price` per trade row
`trade_ledger` schema (`trade_ledger.py:166-190`) stores one `entry_price` + one `exit_price` per row. There is no tax-lot table, no FIFO/LIFO/SpecID selector, and no way to represent partial closes against specific lots. If a user buys 100 shares at three different prices then sells 150, the ledger cannot produce a lot-accurate gain figure. `record_exit` (`trade_ledger.py:540`) closes the oldest open row wholesale — this is a crude FIFO approximation at the *trade-row* level, not at the *share-lot* level IRS requires.

### 3. FIFO is implicit and undocumented; no LIFO/HIFO/SpecID option
`record_exit` uses `ORDER BY id ASC LIMIT 1` (`trade_ledger.py:565`), which effectively closes the oldest open row first. This is not labeled as FIFO in the UI, is not user-selectable, and silently differs from what the broker (Alpaca) reports on the 1099-B. Alpaca default is FIFO but supports per-lot overrides; if the user made a specific-ID election at the broker, AlphaDesk's numbers will disagree with the actual 1099-B line-by-line.

### 4. Short-term / long-term cutoff uses `> 365` days — wrong boundary
`reports/page.tsx:482`: `const isLongTerm = holdingDays > 365;` IRS holding-period rule is "held **more than one year**" meaning the sale date must be **at least one day after the one-year anniversary of the day after acquisition**. For a non-leap year this is effectively `> 365` calendar days from acquisition-day-plus-one, but the code computes `floor((exit - entry) / 86400000)` from raw timestamps. Intraday rounding plus the exclusion of the acquisition date from the holding period means trades held almost exactly a year will be misclassified in either direction. Use calendar-date arithmetic (acquisition date + 1 year + 1 day rule).

### 5. Bucketing by `exit_time` year ignores trade-date vs settlement-date rules
`reports/page.tsx:473`: `new Date(t.exit_time).getFullYear() === taxYear`. For US equities the reportable date on Form 8949 is the **trade date** (not settlement). For short sales, the reportable year is the year the short is **closed/covered**. The code treats `exit_time` as the reportable date for all sides, which is correct for long closes but also happens to be correct for shorts — however the code never distinguishes, and for wash-sale-adjusted losses the "disallowed year" vs "basis-adjusted year" can diverge.

### 6. Gain/loss calculation does not subtract commissions, SEC/TAF fees, or slippage
`trade_ledger.py:583-602` computes `(exit - entry) * qty` in Decimal, which is correct math — but the `entry_price` and `exit_price` stored are the **quoted fill prices**, not **net proceeds / cost basis after fees**. Alpaca is zero-commission on equities, but TAF, SEC §31 fees, FINRA fees, and options contract fees still apply and belong in cost basis per IRS regs. There is no commission/fee column on `trade_ledger` (`trade_ledger.py:166-184`). Form 8949 columns (d) Proceeds and (e) Cost basis will both be overstated.

### 7. Short-sale treatment: no §1233 constructive-sale rule, no ordinary-income conversion
`record_exit` handles long/short P&L correctly for P&L display (`trade_ledger.py:590-602`), but IRS §1233 flips the holding-period rules for shorts: a short sale of a "substantially identical" security you own can trigger a constructive sale, and short-sale gains/losses are always **short-term** regardless of how long the short was open (except for certain hedges). The Tax Report classifies shorts using the same `holdingDays > 365` rule as longs — this is wrong; box-office shorts should never be long-term.

### 8. Qualified vs non-qualified dividends: entirely absent
`grep qualified_dividend` returns zero hits outside strategy docs. Dividend capture strategy (`dividend_capture` in the registry) will generate trades around ex-dividend dates, but:
- No dividend income ledger exists separate from trade P&L.
- No `days_held_around_exdate` computation for the 61-day qualified-dividend test (§1(h)(11)).
- Dividends are not exported on the Tax Report CSV at all (Form 1099-DIV equivalent is missing).
The downloadable CSV has no dividend section — yet dividend capture is an advertised strategy.

### 9. No 1099-B box mapping, no "reported to IRS" / "covered vs noncovered" flag
Real brokers mark each lot A/B/D/E/X (covered short, noncovered short, covered long, noncovered long, unknown basis). AlphaDesk's CSV has columns `Symbol / Side / Quantity / Entry Price / Exit Price / P&L / Entry Date / Exit Date / Holding Days / Classification / Strategy` (`reports/page.tsx:509-522`). This does not map to Form 8949 Part I/II / box A–F. An accountant cannot drop this into tax software without a manual column remap for every row.

### 10. Corporate actions: no splits, no spin-offs, no return-of-capital adjustments
Stored `entry_price` is the raw fill at time of purchase. If the underlying splits 2-for-1 or pays a non-taxable return of capital before exit, the cost basis should adjust. There is no corporate-actions adjustment pipeline (grep for `split`, `spin_off`, `roc` turns up strategy indicators only, not ledger adjustments). Trades spanning a split will show absurd P&L and wrong classification. Related: crypto/options reporting (1099-B vs 1099-MISC vs 1099-NEC) is also not split.

## 250-Word Summary

AlphaDesk's "Tax Report (Simplified)" is correctly labeled **Simplified** — it is not a substitute for a broker-issued 1099-B and an accountant should not file from it. The positives: the report does correctly separate short-term from long-term buckets at the UI level, computes P&L in Decimal with `ROUND_HALF_UP` (eliminating banker's-rounding drift vs. Alpaca), and produces a deterministic CSV with entry/exit dates and holding days. The `trade_ledger` table has a clean schema, survives worker concurrency via a Postgres sequence, and distinguishes long vs short sides.

But ten tax-relevant defects make the output unusable as a compliance artifact. The single largest gap is the total absence of **wash-sale detection** — under §1091, AlphaDesk's own mean-reversion and RSI2 strategies will routinely trigger disallowed losses that this report happily deducts. Second is the **lack of tax-lot tracking**: a single `entry_price` per row cannot represent layered purchases or partial closes; FIFO is implicit and not user-selectable, and will disagree with Alpaca's actual 1099-B wherever the user made a SpecID election. Third is the **omission of fees** from both proceeds and cost basis, systematically overstating both Form 8949 columns.

Additional defects: wrong holding-period boundary (`> 365` days rather than the calendar-date "more than one year" rule), no short-sale §1233 short-term conversion, no qualified-dividend 61-day test, no 1099-B box mapping (A/B/D/E/X), no corporate-action adjustments. Treat this feature as a **management P&L summary** only; for tax filing, use the broker's 1099-B.
