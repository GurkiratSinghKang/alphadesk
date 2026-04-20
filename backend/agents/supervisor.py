from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class SupervisorAgent(BaseAgent):
    """Orchestrator agent that interprets user intent and delegates to specialists.

    The Supervisor is the main entry point for natural language interactions.
    It decomposes complex requests into sub-tasks, routes them to the
    appropriate specialist agents, and synthesises their results into a
    coherent response.
    """

    name = "supervisor"
    model = MODEL_SONNET
    mcp_servers = ["broker", "market_data"]

    system_prompt = """You are the Supervisor Agent for AlphaDesk, a professional trading platform.

Your role is to:
1. Interpret the user's trading-related request
2. Decide which specialist agents to invoke
3. Synthesise their results into a clear, actionable response

Available specialist agents:
- screener: Stock screening with fundamental/technical/ML filters
- technical: Multi-timeframe technical analysis (S/R, patterns, indicators)
- fundamental: Fundamental analysis (F-Score, quality metrics, valuation)
- strategy: Maps analysis signals to concrete options/equity trade structures
- sentiment: Analyses options flow, social sentiment, news sentiment
- earnings: Earnings event specialist (pre/post earnings plays)
- execution: Constructs and submits orders through the broker
- risk: Portfolio risk monitoring, position sizing, exposure limits
- options: IV analysis, greeks, structure optimisation
- portfolio: Performance tracking, analytics, journal
- research: Autonomous strategy discovery and backtesting

When responding:
- Be concise and actionable. Traders value signal over noise.
- Include specific numbers, levels, and trade parameters.
- Flag risks prominently.
- If you need to run multiple agents, do so and combine results.
- Format trade ideas as: Symbol | Strategy | Structure | Entry | Target | Stop | Risk/Reward

Always output a JSON object with keys: response (str), actions (list of dicts), suggestions (list of str).

SAFETY: Never suggest market manipulation, wash trading, spoofing, layering,
or misrepresentation to other market participants. Never recommend specific
securities in a way that could be construed as investment advice from a
registered professional. Refuse to execute trades that would violate Reg SHO,
Reg NMS, or other US securities regulations.
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Parse user intent, delegate to sub-agents, and synthesise."""
        import asyncio
        from agents import get_agent

        # First, ask Claude to plan which agents to invoke
        plan_result = await super().run(
            task=f"""Analyse this user request and determine which specialist agents to call.
Return a JSON object with:
- "agents": list of agent names to invoke
- "sub_tasks": dict mapping agent name to the specific task string for that agent
- "direct_response": null if agents needed, or a string if you can answer directly

User request: {task}""",
            context=context,
        )

        response_text = plan_result.get("response", "")

        # Try to parse the plan
        import json
        try:
            # Extract JSON from response
            json_start = response_text.find("{")
            json_end = response_text.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                plan = json.loads(response_text[json_start:json_end])
            else:
                plan = {"direct_response": response_text}
        except json.JSONDecodeError:
            plan = {"direct_response": response_text}

        # If direct response, return it
        if plan.get("direct_response"):
            return {
                "response": plan["direct_response"],
                "actions": [],
                "suggestions": [],
            }

        # Dispatch to sub-agents
        agent_names = plan.get("agents", [])
        sub_tasks = plan.get("sub_tasks", {})
        actions: list[dict[str, Any]] = []

        async def _invoke(name: str) -> dict[str, Any]:
            agent = get_agent(name)
            if agent is None:
                return {"agent": name, "error": f"Agent '{name}' not available"}
            t = sub_tasks.get(name, task)
            result = await agent.run(t, context=context)
            return {"agent": name, **result}

        results = await asyncio.gather(
            *[_invoke(name) for name in agent_names],
            return_exceptions=True,
        )

        for r in results:
            if isinstance(r, Exception):
                actions.append({"error": str(r)})
            else:
                actions.append(r)

        # Synthesise results into final response
        synthesis = await super().run(
            task=f"""Synthesise these agent results into a single coherent response for the user.

Original request: {task}

Agent results:
{json.dumps(actions, indent=2, default=str)}

Provide a clear, actionable trading response. Include specific levels and trade ideas where applicable.
Output JSON with: response (str), suggestions (list of follow-up questions).
""",
            context=context,
        )

        synth_text = synthesis.get("response", "")
        try:
            json_start = synth_text.find("{")
            json_end = synth_text.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                final = json.loads(synth_text[json_start:json_end])
            else:
                final = {"response": synth_text, "suggestions": []}
        except json.JSONDecodeError:
            final = {"response": synth_text, "suggestions": []}

        return {
            "response": final.get("response", synth_text),
            "actions": actions,
            "suggestions": final.get("suggestions", []),
        }
