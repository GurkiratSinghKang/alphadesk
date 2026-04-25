FROM python:3.12-slim AS base

# Round-5 Cluster D H-8: bake the deploy git SHA into the image so log
# records (core.logging.GIT_SHA) and /livez can surface it. The deploy
# pipeline passes this via --build-arg GIT_SHA=$(git rev-parse HEAD).
# Falls back to "unknown" so a local ``docker build`` without the arg
# still succeeds and produces clean log records.
#
# Round-5 Cluster F G-20 (note for the next maintainer): this image is
# glibc-based (python:3.12-slim is Debian Bookworm), NOT musl/Alpine —
# anything in the Python codebase that calls ``strftime("%-d")`` only
# works on glibc. If the base image ever changes to alpine, audit
# ``services.earnings_screener`` and friends for ``%-`` directives.
ARG GIT_SHA="unknown"
ENV ALPHADESK_GIT_SHA=$GIT_SHA

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    wget \
    curl \
    && wget -q https://github.com/TA-Lib/ta-lib/releases/download/v0.6.4/ta-lib-0.6.4-src.tar.gz \
    && tar -xzf ta-lib-0.6.4-src.tar.gz \
    && cd ta-lib-0.6.4 \
    && ./configure --prefix=/usr \
    && make -j$(nproc) \
    && make install \
    && cd .. \
    && rm -rf ta-lib-0.6.4 ta-lib-0.6.4-src.tar.gz \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get purge -y --auto-remove wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Wave 6γ (persona-114 + Round 5 deferred) — drop root. The original image
# ran as root, so any RCE in FastAPI (or any of its ~200 transitive Python
# deps) landed at UID 0 inside the container. A compromised-root escape via
# a kernel CVE would reach the host as root. Running as an unprivileged user
# limits the blast radius: even with full container compromise the attacker
# lands as ``alphadesk`` (uid 10001), and any host mount that wasn't
# explicitly chowned stays read-only to them.
#
# UID 10001 is above the Debian reserved range (< 1000 are system accounts;
# 1000-10000 are common defaults) which lowers the odds of uid collision
# with a host user on bind-mounted volumes. ``chown -R`` on ``/app``
# ensures the app code and the lifespan bg services' write targets
# (``/app/data/pipeline_logs`` in particular) are writable by the new user.
# Operators bind-mounting a host directory over that path must ``chown
# 10001:10001`` on the host side or pass ``--user`` to match.
RUN useradd -m -u 10001 alphadesk \
    && chown -R alphadesk:alphadesk /app
USER alphadesk

EXPOSE 8000

# Wave 3L Fix 7 (persona-86/90): drop gunicorn workers from 3 to 1. On a
# 2 vCPU box, -w 3 was oversubscribed (context-switch overhead) and —
# more critically — every worker spawned the lifespan background
# services (Alpaca stream, pipeline scheduler, realtime scanner,
# continuous monitor, fill reconciler). Three copies of the scheduler
# ticking once per minute created a concrete duplicate-order risk on
# live paper accounts. A single worker is the safe default until
# lifespan bg services are protected by a distributed leader-election
# lock (tracked for a follow-up wave). Single-worker FastAPI with
# uvloop (Fix 5) and ORJSONResponse (Fix 4) still comfortably handles
# our traffic level; horizontal scaling remains an option behind Caddy.
CMD ["gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "1", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-"]
