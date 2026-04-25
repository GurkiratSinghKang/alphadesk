"""Round-6 / I-17: package marker for rsi2_reversal tests.

Without an explicit ``__init__.py`` the package-local ``conftest.py``
boot-straps were ambiguous when invoked through different pytest
roots, and pytest's rootdir detection occasionally placed the package
under ``backend.strategies`` vs. ``strategies`` causing class-identity
skew at the registry boundary. The marker here makes the package
shape explicit.
"""
