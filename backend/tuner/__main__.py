"""Module-exec entry: ``python -m backend.tuner``.

Delegates to :func:`backend.tuner.runner.main`.
"""

from __future__ import annotations

import sys

from tuner.runner import main

if __name__ == "__main__":
    sys.exit(main())
