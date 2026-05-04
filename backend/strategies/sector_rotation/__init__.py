"""Sector Rotation — long-only monthly rotation across 11 GICS sector ETFs.

Importing this package fires the ``@register_strategy`` decorator on
:class:`SectorRotationStrategy`, registering it under ``"sector_rotation"`` in
the ``strategies._core.protocol`` registry.
"""

from .strategy import SectorRotationStrategy

__all__ = ["SectorRotationStrategy"]
