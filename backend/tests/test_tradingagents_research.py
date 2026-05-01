from __future__ import annotations

import pytest

from services import tradingagents_research as svc


def test_normalize_symbol_blocks_shell_payloads() -> None:
    assert svc.normalize_symbol("aapl") == "AAPL"
    with pytest.raises(ValueError):
        svc.normalize_symbol("AAPL;rm -rf /")


def test_normalize_analysts_deduplicates_and_validates() -> None:
    assert svc.normalize_analysts(["market", "news", "market"]) == ["market", "news"]
    assert svc.normalize_analysts("social,fundamentals") == ["social", "fundamentals"]
    with pytest.raises(ValueError):
        svc.normalize_analysts(["market", "macro"])


def test_extract_json_payload_tolerates_bootstrap_prefix() -> None:
    payload = svc.extract_json_payload(
        "bootstrapping TradingAgents...\n"
        '{"ticker":"AAPL","summary_lines":["buy-side debate"]}\n'
    )
    assert payload["ticker"] == "AAPL"
    assert payload["summary_lines"] == ["buy-side debate"]


def test_build_command_uses_wrapper_and_json_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        svc.settings,
        "TRADINGAGENTS_SCRIPT_PATH",
        "/tmp/run_tradingagents.sh",
    )
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_OUTPUT_LANGUAGE", "English")
    cmd = svc.build_command(
        {
            "symbol": "MSFT",
            "trade_date": "2026-05-01",
            "provider": "openai",
            "deep_model": "gpt-5.4",
            "quick_model": "gpt-5.4-mini",
            "analysts": ["market", "news"],
            "research_depth": 2,
        }
    )
    assert cmd[:4] == ["/bin/bash", "/tmp/run_tradingagents.sh", "MSFT", "2026-05-01"]
    assert "--json" in cmd
    assert cmd[cmd.index("--analysts") + 1] == "market,news"
    assert cmd[cmd.index("--output-language") + 1] == "English"
    assert cmd[cmd.index("--research-depth") + 1] == "2"


def test_runtime_status_reports_bootstrap_and_key_state(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    script = tmp_path / "run_tradingagents.sh"
    script.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    skill_home = tmp_path / "skill-home"

    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_ENABLED", True)
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_SCRIPT_PATH", str(script))
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_SKILL_HOME", str(skill_home))
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_PROVIDER", "anthropic")
    monkeypatch.setattr(svc.settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    status = svc.get_tradingagents_runtime_status()

    assert status["script_exists"] is True
    assert status["script_runnable"] is True
    assert status["provider_key_configured"] is False
    assert status["bootstrap_required"] is True
    assert status["ready"] is False
    assert any("ANTHROPIC_API_KEY" in warning for warning in status["warnings"])


def test_normalize_public_record_backfills_new_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_TIMEOUT_S", 600)
    normalized = svc._normalize_public_record(
        {
            "run_id": "abc123abc123abc123abc123",
            "symbol": "AAPL",
            "trade_date": "2026-05-01",
        }
    )

    assert normalized is not None
    assert normalized["analysts"] == ["market", "social", "news", "fundamentals"]
    assert normalized["progress_message"] is None
    assert normalized["timeout_s"] == 1800


def test_effective_timeout_expands_for_full_anthropic_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_TIMEOUT_S", 600)

    timeout_s = svc._effective_timeout_s(
        {
            "provider": "anthropic",
            "analysts": ["market", "social", "news", "fundamentals"],
            "research_depth": 1,
        }
    )

    assert timeout_s == 1800


def test_effective_timeout_respects_higher_operator_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_TIMEOUT_S", 2400)

    timeout_s = svc._effective_timeout_s(
        {
            "provider": "anthropic",
            "analysts": ["market"],
            "research_depth": 1,
        }
    )

    assert timeout_s == 2400


@pytest.mark.asyncio
async def test_start_run_queues_and_deduplicates(monkeypatch: pytest.MonkeyPatch) -> None:
    svc._INMEM_RUNS.clear()
    svc._INMEM_USER_RUNS.clear()
    scheduled: list[str] = []

    def fake_supervised_task(coro, *, name: str):
        scheduled.append(name)
        coro.close()
        return None

    async def fake_load(username: str, run_id: str):
        return svc._INMEM_RUNS.get(svc._run_key(username, run_id))

    async def fake_store(username: str, record: dict):
        svc._INMEM_RUNS[svc._run_key(username, record["run_id"])] = svc._public_record(record)
        ids = svc._INMEM_USER_RUNS.setdefault(username, [])
        if record["run_id"] not in ids:
            ids.insert(0, record["run_id"])

    monkeypatch.setattr(svc, "create_supervised_task", fake_supervised_task)
    monkeypatch.setattr(svc, "_load_record", fake_load)
    monkeypatch.setattr(svc, "_store_record", fake_store)
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_ENABLED", True)
    monkeypatch.setattr(svc.settings, "TRADINGAGENTS_PROVIDER", "openai")

    first = await svc.start_tradingagents_run(
        "test_user",
        {"symbol": "nvda", "trade_date": "2026-05-01", "research_depth": 1},
    )
    second = await svc.start_tradingagents_run(
        "test_user",
        {"symbol": "NVDA", "trade_date": "2026-05-01", "research_depth": 1},
    )

    assert first["status"] == "queued"
    assert first["timeout_s"] >= 600
    assert second["run_id"] == first["run_id"]
    assert len(scheduled) == 1


@pytest.mark.asyncio
async def test_missing_wrapper_fails_before_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        svc.settings,
        "TRADINGAGENTS_SCRIPT_PATH",
        "/tmp/definitely-missing-tradingagents.sh",
    )
    with pytest.raises(svc.TradingAgentsRunError) as exc:
        await svc._run_subprocess(
            {
                "symbol": "AAPL",
                "trade_date": "2026-05-01",
                "provider": "openai",
                "deep_model": "gpt-5.4",
                "quick_model": "gpt-5.4-mini",
                "analysts": ["market"],
                "research_depth": 1,
            }
        )
    assert exc.value.status == "unavailable"
