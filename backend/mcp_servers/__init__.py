from __future__ import annotations

from typing import Any, Callable, Awaitable

_TOOL_REGISTRY: dict[str, Callable[..., Awaitable[Any]]] = {}


def register_tool(name: str, handler: Callable[..., Awaitable[Any]]) -> None:
    """Register an MCP tool handler globally."""
    _TOOL_REGISTRY[name] = handler


def get_mcp_tool(name: str) -> Callable[..., Awaitable[Any]] | None:
    """Look up a registered MCP tool by name."""
    return _TOOL_REGISTRY.get(name)


def list_tools() -> list[str]:
    return list(_TOOL_REGISTRY.keys())
