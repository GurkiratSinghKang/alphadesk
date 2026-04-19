"""baseline

Revision ID: 0001_baseline
Revises:
Create Date: 2026-04-18

Baseline migration for AlphaDesk.

Alembic is being bootstrapped AFTER the production database already exists.
The tables in ``backend/data/storage/models.py`` were originally created via
``Base.metadata.create_all`` at app startup (and topped up by ad-hoc
``ADD COLUMN IF NOT EXISTS`` DDL in a few modules).  Rather than try to
regenerate the whole schema from the models -- which risks diverging from
what's live -- this revision is intentionally empty.

Operators MUST run ``alembic stamp 0001_baseline`` exactly once on every
pre-existing database to mark it as up-to-date with this baseline.  New
environments (fresh clones, CI) can skip the stamp and just run
``alembic upgrade head`` from scratch -- they will still pick up subsequent
revisions.

After this baseline is in place, all schema changes should go through
Alembic:
    alembic revision --autogenerate -m "description"
"""
from __future__ import annotations

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Intentionally empty. See the module docstring -- existing databases
    # should be stamped with ``alembic stamp 0001_baseline`` so Alembic treats
    # them as already-at-baseline.  Fresh databases created via
    # ``Base.metadata.create_all`` (the legacy boot path) will also already
    # match this baseline, so there's nothing to do here.
    pass


def downgrade() -> None:
    # Baseline has no downgrade -- you can't "undo" the schema the app was
    # born with.  If a rollback is required, restore from a database backup.
    pass
