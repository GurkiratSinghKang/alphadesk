FROM python:3.12-slim AS base

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
