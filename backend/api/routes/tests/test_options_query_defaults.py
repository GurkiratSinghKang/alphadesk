"""Regression test for the earnings screener hydration bug where
`get_options_chain` leaked FastAPI `Query(...)` sentinel objects into its
downstream code when called directly as a Python helper (e.g. from
`services.earnings_screener._load_metrics`). The Query object has no
`.value` attribute, so `_fetch_real_chain` crashed with:

    AttributeError: 'Query' object has no attribute 'value'

Using `Annotated[..., Query()] = None` instead of `= Query(None)` keeps the
Python default as a real `None` while still letting FastAPI route the
request as a query parameter.
"""
import inspect

from fastapi import Query

from api.routes.options import get_options_chain


def test_get_options_chain_direct_call_defaults_are_real_none():
    """When called as a plain Python function (not as a FastAPI route),
    all optional parameters must default to real `None` values, not
    `Query(...)` sentinels. Otherwise downstream code paths that do things
    like `option_type.value` crash with AttributeError."""
    sig = inspect.signature(get_options_chain)
    for name in ("expiry", "strike_min", "strike_max", "option_type"):
        default = sig.parameters[name].default
        assert default is None, (
            f"{name} default is {default!r}, expected None. "
            "A Query(...) leak here breaks direct callers like "
            "services.earnings_screener._load_metrics."
        )
        assert not isinstance(default, type(Query())), (
            f"{name} default is a Query instance — will crash callers"
        )
