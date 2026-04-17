"""vrp_harvest strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`VRPHarvestStrategy`, registering it under ``"vrp_harvest"`` in
the strategy registry.

The decorator is wrapped with :func:`strategy._safe_register` so
double-loading under the legacy ``strategies.vrp_harvest`` alias is
tolerated.
"""

from .strategy import VRPHarvestStrategy

__all__ = ["VRPHarvestStrategy"]
