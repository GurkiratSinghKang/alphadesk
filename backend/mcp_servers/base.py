from __future__ import annotations

import inspect
import logging
from abc import ABC
from typing import Any, Callable, Awaitable

from mcp_servers import register_tool


class BaseMCPServer(ABC):
    """Base class for MCP (Model Context Protocol) tool servers.

    Provides a decorator-based tool registration pattern. Subclasses
    define async methods decorated with @tool() to expose them as
    callable tools for the agent system.

    Example usage in a subclass:

        class MarketDataServer(BaseMCPServer):
            name = "market_data"

            @BaseMCPServer.tool("get_quote", "Fetch real-time quote for a symbol")
            async def get_quote(self, symbol: str) -> dict:
                ...
    """

    name: str = "base"
    _tools: dict[str, dict[str, Any]]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        cls._tools = {}

        # Collect methods decorated with @tool
        for attr_name in dir(cls):
            attr = getattr(cls, attr_name, None)
            if callable(attr) and hasattr(attr, "_tool_meta"):
                meta = attr._tool_meta
                cls._tools[meta["name"]] = {
                    "description": meta["description"],
                    "handler_name": attr_name,
                    "parameters": meta.get("parameters", {}),
                }

    def __init__(self) -> None:
        self.logger = logging.getLogger(f"mcp.{self.name}")
        # Register all tools in the global registry
        for tool_name, tool_info in self._tools.items():
            qualified_name = f"{self.name}.{tool_name}"
            handler = getattr(self, tool_info["handler_name"])
            register_tool(qualified_name, handler)
            register_tool(tool_name, handler)  # also register short name
        self.logger.info("Registered %d tools for %s", len(self._tools), self.name)

    @staticmethod
    def tool(name: str, description: str, parameters: dict[str, Any] | None = None):
        """Decorator to mark a method as an MCP tool."""
        def decorator(func: Callable) -> Callable:
            # Auto-extract parameters from type hints if not provided
            params = parameters
            if params is None:
                sig = inspect.signature(func)
                params = {}
                for pname, param in sig.parameters.items():
                    if pname == "self":
                        continue
                    ptype = "string"
                    if param.annotation is int:
                        ptype = "integer"
                    elif param.annotation is float:
                        ptype = "number"
                    elif param.annotation is bool:
                        ptype = "boolean"
                    params[pname] = {"type": ptype}

            func._tool_meta = {
                "name": name,
                "description": description,
                "parameters": params,
            }
            return func
        return decorator

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return tool definitions in Claude API format."""
        definitions = []
        for tool_name, tool_info in self._tools.items():
            definitions.append({
                "name": tool_name,
                "description": tool_info["description"],
                "input_schema": {
                    "type": "object",
                    "properties": tool_info["parameters"],
                    "required": [
                        k for k, v in tool_info["parameters"].items()
                        if not v.get("optional", False)
                    ],
                },
            })
        return definitions
