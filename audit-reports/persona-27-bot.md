# Persona 27 — Discord Bot Builder

**Date:** 2026-04-18
**Persona:** Dev building a Discord bot that pings on fills, alerts, and pipeline completion.
**Base URL:** `https://tradingalpha.net/api/v1`
**Questions:** Outbound webhooks? What triggers fires? Subscription mechanism?

---

## TL;DR — Can I build this bot?

**Only with a hack.** There is **one** hardcoded `DISCORD_WEBHOOK_URL` env var and **two** fire paths. There is **no subscription mechanism**, no per-event filtering, no HMAC signing, and crucially **no `trade_updates` listener** — so fills (the feature the user explicitly asked for) are **never observable**. Pipeline completion fires nothing. The bot author has three choices, all bad: (1) hijack the single Discord URL and accept only 2 kinds of messages; (2) poll `/trades/orders` every few seconds; (3) build a shadow WebSocket client subscribing to `/ws` channels.

---

## Top 10 findings

**1. Only two endpoints in `webhooks.py` — both inbound, none outbound.** `webhooks.py` contains exactly one decorated route: `POST /webhooks/tradingview` (line 47). There is no `POST /webhooks/subscriptions`, no `GET /webhooks/subscriptions`, no per-user webhook registration. Verified against prod: `curl https://tradingalpha.net/api/v1/webhooks/subscriptions` → **404**. Persona-11 finding #7 confirms "No outbound webhook system." The Discord bot cannot register itself.

**2. `DISCORD_WEBHOOK_URL` is a single global secret, not a per-user/per-bot subscription.** `backend/core/config.py:70` declares `DISCORD_WEBHOOK_URL: SecretStr = SecretStr("")`. One URL, one consumer, shared across every installation. Two or more Discord bots cannot coexist without external fan-out. No signing key (no `DISCORD_WEBHOOK_SECRET`) — any actor with the URL can spoof messages back into Discord, but the bot can't verify the origin came from AlphaDesk vs a replay.

**3. Only two code paths actually call Discord.** Grep for `DISCORD_WEBHOOK_URL` returns exactly 2 fire sites:
  - `backend/api/routes/webhooks.py:195-203` (`_send_notification`) — fires only when an **inbound** TradingView webhook arrives and routes to `_handle_trade_signal / _handle_close_signal / _handle_info_alert`.
  - `backend/data/ingestion/daily_pipeline.py:1075-1083` — fires **only** when the circuit-breaker trips (daily P&L exceeds `CIRCUIT_BREAKER_PCT = -2%`).

That's it. **No fill notifications, no generic pipeline-completion ping, no stop/target hits, no risk breaches, no strategy signals are Discord-delivered.**

**4. Fills are never detected.** `alpaca_stream.py` subscribes to the **market-data** WebSocket (`wss://stream.data.alpaca.markets`), publishing `quotes` and `bars`. It does **not** subscribe to Alpaca's **trading** stream (`wss://paper-api.alpaca.markets/stream` with `trade_updates`). Grep confirms: zero matches for `trade_updates`, `TradingStream`, or `/v1/events`. So when a strategy's limit order fills at Alpaca, AlphaDesk learns about it only by polling `/trades/orders`. The Discord bot therefore *cannot* be notified of fills — because AlphaDesk itself isn't notified.

**5. Pipeline completion fires nothing to Discord.** `daily_pipeline.py:1381-1383` sets `_pipeline_status["last_result"] = "success" | "completed_with_errors"` in a `finally` block, but there is no `await _send_notification(...)` on the success path. Only the circuit-breaker aborts (line 1078) trigger Discord. A bot that wants "pipeline done" must poll `GET /pipeline/status` and diff `last_result` / `last_run`.

**6. "Alerts" exist as a Redis pub/sub channel, not a webhook fire.** 5 producers publish to Redis channel `"alerts"`:
  - `webhooks.py:112` (TV alert broadcast)
  - `continuous_monitor.py:64` (news alert), `:135` (price-near-stop)
  - `realtime_scanner.py:381` (realtime signal)
  - `trades.py:1159` (price-level alert triggered)

None of these publishers call `_send_notification`. They publish to Redis → WebSocket fan-out to browser clients on channel `alerts`. **A Discord bot cannot hook Redis pub/sub** (Redis is on a private Hetzner network); it must connect to `wss://tradingalpha.net/ws` and subscribe to `alerts`.

**7. The WebSocket at `/ws` is the ONLY viable push path — but auth is user-token based.** `api/websocket/handler.py:195-244` requires either an `access_token` cookie or a first-message `{"action":"auth","token":"<JWT>"}` within 5s (else close code 4001). JWTs are minted via `POST /auth/login` with username+password and expire in 8h (`ACCESS_TOKEN_EXPIRE_MINUTES=480`). **There is no API-key flow.** A 24/7 bot must either (a) persist the admin password and re-login every 8h, or (b) use refresh-token rotation with a 30d TTL and handle rotation/rollover. Both are fragile; both tie the bot to a human user's credentials. Available channels: `quotes`, `portfolio`, `alerts`, `agents`, `bars` (`core/redis.py:42-48`).

**8. No HMAC-signed outbound payloads.** The Discord `_send_notification` call at `webhooks.py:200` sends `{"content": "**[AlphaDesk]** <msg>"}` raw — no timestamp, no signature, no nonce, no replay protection. Contrast with the **inbound** TradingView handler (`webhooks.py:73-80`) which requires `X-TV-Secret` HMAC-compared against `TRADINGVIEW_WEBHOOK_SECRET`. The outbound side has no equivalent. A bot receiving the Discord webhook payload cannot cryptographically verify it came from AlphaDesk.

**9. Circuit-breaker notification has a silent-fail swallow.** `daily_pipeline.py:1079-1083`:
```
except Exception:
    logger.critical("Circuit breaker notify failed — oncall will not be paged via Discord", exc_info=True)
```
If Discord 429s, DNS fails, or the URL is stale, the pipeline halts but nobody is paged. There's no retry, no fallback to Telegram on the circuit-breaker path (only `webhooks._send_notification` multiplexes to both). The critical event that needs the loudest ping has the weakest delivery guarantee.

**10. Telegram and Discord are tightly coupled, not pluggable.** `_send_notification` at `webhooks.py:175-203` hardcodes Telegram + Discord as the only sinks, with two independent `try/except` blocks, no retry, no persistence, no delivery log. Adding Slack / PagerDuty / custom-bot-URL means editing this function and redeploying. There is no notification abstraction layer, no message type/severity taxonomy, no per-channel routing rules. A bot operator who wants "only fills, not alerts" has no filter.

---

## What actually triggers Discord (exhaustive list)

| Event | Fires Discord? | Source | Via |
|---|---|---|---|
| Inbound TradingView `buy/sell` alert | yes (if execution agent unavailable, fallback only) | `webhooks.py:142` | `_send_notification` |
| Inbound TradingView `close` | yes | `webhooks.py:161` | `_send_notification` |
| Inbound TradingView `alert` | yes | `webhooks.py:169` | `_send_notification` |
| Circuit breaker (daily P&L < -2%) | yes | `daily_pipeline.py:1078` | direct `httpx.post` |
| Order fill (Alpaca) | **no** | — | not subscribed |
| Order submitted | no (WS only) | `trades.py:428` | `publish("portfolio", ...)` |
| Price alert triggered | no (WS only) | `trades.py:1159` | `publish("alerts", ...)` |
| News alert on holding | no (WS only) | `continuous_monitor.py:64` | `publish("alerts", ...)` |
| Position near stop/target | no (WS only) | `continuous_monitor.py:135` | `publish("alerts", ...)` |
| Realtime scanner signal | no (WS only) | `realtime_scanner.py:381` | `publish("alerts", ...)` |
| Pipeline success / completed_with_errors | **no** | `daily_pipeline.py:1383` | state-only flag |
| Pipeline cancelled | no | `daily_pipeline.py:1372` | state-only flag |
| Stop-loss hit, position closed | no | — | no dedicated hook |
| Risk breach (drawdown, exposure) | no | `risk.py` | no notification hook |

---

## How a working Discord bot must be built today

1. **Bot runs as a long-lived process** outside AlphaDesk (own VM/container).
2. **Login loop**: `POST /auth/login` with username/password → receive `access_token` (8h TTL) + `refresh_token` (30d TTL). Schedule refresh every ~7h via `POST /auth/refresh`.
3. **Open `wss://tradingalpha.net/ws`**, auth via first-message JWT or carry the cookie.
4. **Subscribe** to `alerts`, `portfolio`, `agents` channels. (`signals` channel is in the handler enum but not in `ALL_CHANNELS` — see persona-11 #12 inconsistency.)
5. **Poll `GET /trades/orders`** every 5-15s to detect new fills (no push available).
6. **Poll `GET /pipeline/status`** every 30-60s, diff `last_run` to detect completions.
7. **Poll `GET /risk/dashboard`** periodically for breaches.
8. **Forward filtered events to Discord via the bot's own Discord webhook** — do NOT reuse `DISCORD_WEBHOOK_URL` (that's for the circuit breaker only).

---

## Test evidence

```
$ curl -s -o /dev/null -w "%{http_code}\n" https://tradingalpha.net/api/v1/webhooks/subscriptions
404
$ curl -s -o /dev/null -w "%{http_code}\n" -X POST https://tradingalpha.net/api/v1/webhooks/tradingview -H "Content-Type: application/json" -d '{}'
503  (TRADINGVIEW_WEBHOOK_SECRET not configured in prod)
$ curl -s -o /dev/null -w "%{http_code}\n" https://tradingalpha.net/api/v1/bots
404
$ curl -s -o /dev/null -w "%{http_code}\n" https://tradingalpha.net/api/v1/notifications
404
```

---

## Summary (248 words)

AlphaDesk is **not** ready for a Discord bot. There is a single `DISCORD_WEBHOOK_URL` secret (`core/config.py:70`) and two fire sites in the entire codebase — the inbound TradingView handler's fallback notification and the daily-pipeline circuit-breaker. Every other notable event (fills, stop hits, risk breaches, pipeline completion, strategy signals, price/news alerts) travels by Redis pub/sub to the `/ws` WebSocket fan-out and never touches the Discord webhook. Fills specifically are invisible because `alpaca_stream.py` subscribes only to the market-data stream and ignores Alpaca's `trade_updates` channel; AlphaDesk itself polls to learn of fills, so a bot has no push path. There is no subscription mechanism — grep confirms zero routes matching `subscriptions`, zero HMAC signing on outbound payloads, zero per-user or per-event filter, zero retry/DLQ on delivery failure. The only usable push channel is the user-authenticated WebSocket at `/ws`, which needs a human JWT refreshed every 8h and has no bot/API-key mode. A working bot today must log in with a human account, open the WS, subscribe to `alerts` + `portfolio`, and poll `/trades/orders` and `/pipeline/status` on a timer — then forward to its own Discord webhook, not AlphaDesk's. Required fixes for first-class support: a `/webhooks/subscriptions` CRUD endpoint with HMAC-signed POSTs (persona-11 P1 already flags this), an Alpaca `trade_updates` listener that publishes a `fills` channel, a notification layer with per-event routing, and bot-oriented auth (API key or OAuth client_credentials).

---

## Files referenced

- `/Users/GK/Downloads/alphadesk/backend/api/routes/webhooks.py` — single inbound TV route; `_send_notification` multiplexes Telegram+Discord
- `/Users/GK/Downloads/alphadesk/backend/core/config.py` — line 70 single global `DISCORD_WEBHOOK_URL`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/daily_pipeline.py` — lines 1075-1083 circuit-breaker direct Discord post; lines 1381-1383 success path with no notification
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/alpaca_stream.py` — market-data only, no `trade_updates`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/continuous_monitor.py` — news + near-stop alerts to Redis
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/realtime_scanner.py` — realtime signal to Redis
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` — order_submitted (line 428) and price-alert triggered (line 1159) to Redis only
- `/Users/GK/Downloads/alphadesk/backend/core/redis.py` — `ALL_CHANNELS = [quotes, portfolio, alerts, agents, bars]`
- `/Users/GK/Downloads/alphadesk/backend/api/websocket/handler.py` — JWT-auth WS, close codes 4001/1008
- `/Users/GK/Downloads/alphadesk/audit-reports/persona-11-api-consumer.md` — pre-existing findings #7 (no outbound webhooks) and #12 (WS undocumented)
