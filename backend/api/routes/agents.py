from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str = Field(..., description="user or assistant")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: str | None = Field(None, description="Existing conversation ID to continue")
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context (current symbol, portfolio state, etc.)",
    )


class ChatResponse(BaseModel):
    conversation_id: str
    message: str
    actions_taken: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of actions the agent performed (screened, analyzed, ordered, etc.)",
    )
    suggestions: list[str] = Field(
        default_factory=list,
        description="Follow-up suggestions for the user",
    )
    timestamp: datetime


class AgentStatusEntry(BaseModel):
    agent: str
    status: str = Field(..., description="idle, running, error, unconfigured")
    last_run: datetime | None = None
    current_task: str | None = None
    queue_depth: int = 0


class AgentPipelineStatus(BaseModel):
    agents: list[AgentStatusEntry]
    active_tasks: int
    queued_tasks: int
    timestamp: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_AGENT_NAMES = [
    "supervisor", "screener", "technical", "fundamental", "strategy",
    "sentiment", "earnings", "execution", "risk", "options",
    "portfolio", "research",
]


def _claude_unavailable() -> bool:
    """Check if neither Claude CLI nor API key is available."""
    from agents.base import CLAUDE_CLI
    if CLAUDE_CLI:
        return False  # CLI is available
    from core.config import settings
    return not settings.ANTHROPIC_API_KEY.get_secret_value()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def agent_chat(
    request: ChatRequest,
) -> ChatResponse:
    """Natural language interaction with the AlphaDesk agent system.

    The Supervisor agent interprets the user's intent and delegates to
    specialist agents as needed. Examples:

    - "Analyze NVDA for a swing trade"
    - "What's the best options play on AAPL earnings?"
    - "Screen for high momentum names with low IV rank"
    - "Show me my portfolio risk"
    - "Place a 10-delta strangle on TSLA 30 DTE"
    """
    if _claude_unavailable():
        conversation_id = request.conversation_id or str(uuid.uuid4())
        return ChatResponse(
            conversation_id=conversation_id,
            message=(
                "Claude API key not configured. Add ANTHROPIC_API_KEY to your .env file "
                "to enable AI-powered analysis and natural language interaction with the "
                "AlphaDesk agent system. In the meantime, you can still use the screener, "
                "options chain, and market data panels which work with demo data."
            ),
            actions_taken=[],
            suggestions=[
                "Add ANTHROPIC_API_KEY to .env",
                "Try the screener panel",
                "View market data for AAPL",
                "Check the options chain",
            ],
            timestamp=datetime.now(timezone.utc),
        )

    try:
        from agents.supervisor import SupervisorAgent
        from core.redis import cache_get, cache_set

        conversation_id = request.conversation_id or str(uuid.uuid4())

        # Load conversation history from cache
        history_key = f"conversation:{conversation_id}"
        history: list[dict] = (await cache_get(history_key)) or []
        history.append({"role": "user", "content": request.message})

        # Build context for the supervisor
        context = {
            **request.context,
            "conversation_history": history[-20:],
        }

        # Run supervisor agent
        supervisor = SupervisorAgent()
        result = await supervisor.run(
            task=request.message,
            context=context,
        )

        assistant_message = result.get("response", "I encountered an issue processing your request.")
        actions = result.get("actions", [])
        suggestions = result.get("suggestions", [])

        # Update conversation history
        history.append({"role": "assistant", "content": assistant_message})
        await cache_set(history_key, history, ttl_seconds=3600)

        return ChatResponse(
            conversation_id=conversation_id,
            message=assistant_message,
            actions_taken=actions,
            suggestions=suggestions,
            timestamp=datetime.now(timezone.utc),
        )
    except Exception as exc:
        conversation_id = request.conversation_id or str(uuid.uuid4())
        return ChatResponse(
            conversation_id=conversation_id,
            message=f"Agent system encountered an error: {str(exc)[:200]}. Please check your configuration.",
            actions_taken=[],
            suggestions=["Check API keys in .env", "Try again"],
            timestamp=datetime.now(timezone.utc),
        )


@router.get("/status", response_model=AgentPipelineStatus)
async def get_agent_status() -> AgentPipelineStatus:
    """Return the current status of all agents in the pipeline."""
    if _claude_unavailable():
        return AgentPipelineStatus(
            agents=[
                AgentStatusEntry(
                    agent=name,
                    status="unconfigured",
                    last_run=None,
                    current_task=None,
                    queue_depth=0,
                )
                for name in _AGENT_NAMES
            ],
            active_tasks=0,
            queued_tasks=0,
            timestamp=datetime.now(timezone.utc),
        )

    try:
        from core.redis import get_redis

        r = await get_redis()

        entries = []
        active = 0
        queued = 0

        for name in _AGENT_NAMES:
            status_raw = await r.hgetall(f"agent_status:{name}")
            status = status_raw.get("status", "idle") if status_raw else "idle"
            if status == "running":
                active += 1

            queue_len = await r.llen(f"agent_queue:{name}")
            queued += queue_len

            entries.append(AgentStatusEntry(
                agent=name,
                status=status,
                last_run=datetime.fromisoformat(status_raw["last_run"]) if status_raw.get("last_run") else None,
                current_task=status_raw.get("current_task") if status_raw else None,
                queue_depth=queue_len,
            ))

        return AgentPipelineStatus(
            agents=entries,
            active_tasks=active,
            queued_tasks=queued,
            timestamp=datetime.now(timezone.utc),
        )
    except Exception:
        # Redis not available — return unconfigured status
        logger.warning("Failed to fetch agent status from Redis", exc_info=True)
        return AgentPipelineStatus(
            agents=[
                AgentStatusEntry(
                    agent=name,
                    status="unconfigured",
                    last_run=None,
                    current_task=None,
                    queue_depth=0,
                )
                for name in _AGENT_NAMES
            ],
            active_tasks=0,
            queued_tasks=0,
            timestamp=datetime.now(timezone.utc),
        )
