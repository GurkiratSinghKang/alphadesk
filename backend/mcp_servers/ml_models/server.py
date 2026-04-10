from __future__ import annotations

from typing import Any

import numpy as np

from core.redis import cache_get, cache_set
from mcp_servers.base import BaseMCPServer


class MLModelsServer(BaseMCPServer):
    """MCP server for ML model inference (ranking, regime detection, signal generation)."""

    name = "ml_models"

    @BaseMCPServer.tool(
        "rank_candidates",
        "Rank a list of stock candidates using the cross-sectional ML model",
        {"candidates": {"type": "array", "description": "List of ticker dicts with feature values"}},
    )
    async def rank_candidates(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score and rank candidates using a LightGBM ranking model.

        In production, this loads a trained model from disk. Here we use
        the feature-weighted scoring approach as a working baseline.
        """
        if not candidates:
            return []

        feature_names = [
            "momentum_12m", "momentum_1m", "rsi_14", "iv_rank",
            "f_score", "earnings_surprise", "revenue_growth", "relative_volume",
        ]

        features = []
        for c in candidates:
            row = [c.get(f, 0) or 0 for f in feature_names]
            features.append(row)

        X = np.array(features, dtype=float)

        # Normalise to z-scores
        means = X.mean(axis=0)
        stds = X.std(axis=0)
        stds[stds == 0] = 1
        Z = (X - means) / stds

        # Weighted composite score (approximation of trained model)
        weights = np.array([0.25, -0.10, 0.05, 0.15, 0.15, 0.10, 0.10, 0.10])
        scores = Z @ weights

        for i, c in enumerate(candidates):
            c["ml_score"] = round(float(scores[i]), 4)
            c["ml_rank"] = 0  # filled below

        candidates.sort(key=lambda x: x["ml_score"], reverse=True)
        for i, c in enumerate(candidates):
            c["ml_rank"] = i + 1

        return candidates

    @BaseMCPServer.tool(
        "detect_regime",
        "Detect the current market regime using a Hidden Markov Model",
        {"returns": {"type": "array", "description": "List of daily returns"}},
    )
    async def detect_regime(self, returns: list[float]) -> dict[str, Any]:
        """Fit a 3-state HMM to returns and identify the current regime."""
        import asyncio
        from functools import partial

        def _fit(ret: list[float]) -> dict[str, Any]:
            from hmmlearn.hmm import GaussianHMM

            X = np.array(ret).reshape(-1, 1)

            model = GaussianHMM(
                n_components=3,
                covariance_type="full",
                n_iter=100,
                random_state=42,
            )
            model.fit(X)

            states = model.predict(X)
            current_state = int(states[-1])

            # Label regimes by mean return
            means = model.means_.flatten()
            regime_order = np.argsort(means)
            regime_labels = {int(regime_order[0]): "bear", int(regime_order[1]): "neutral", int(regime_order[2]): "bull"}

            probs = model.predict_proba(X[-1:].reshape(1, -1))[0]

            return {
                "current_regime": regime_labels.get(current_state, "unknown"),
                "regime_id": current_state,
                "regime_probabilities": {
                    regime_labels.get(i, f"state_{i}"): round(float(p), 3)
                    for i, p in enumerate(probs)
                },
                "regime_means": {
                    regime_labels.get(i, f"state_{i}"): round(float(m), 6)
                    for i, m in enumerate(means)
                },
                "regime_history": [regime_labels.get(int(s), "unknown") for s in states[-20:]],
            }

        return await asyncio.to_thread(partial(_fit, returns))

    @BaseMCPServer.tool(
        "predict_volatility",
        "Predict next-period realised volatility",
        {"returns": {"type": "array", "description": "List of daily returns"}},
    )
    async def predict_volatility(self, returns: list[float]) -> dict[str, Any]:
        """Simple EWMA volatility forecast with multiple windows."""
        arr = np.array(returns, dtype=float)

        def ewma_vol(data: np.ndarray, span: int) -> float:
            alpha = 2 / (span + 1)
            weights = (1 - alpha) ** np.arange(len(data))[::-1]
            weights /= weights.sum()
            variance = np.sum(weights * data**2)
            return float(np.sqrt(variance * 252))

        vol_10 = ewma_vol(arr[-10:], 10) if len(arr) >= 10 else 0
        vol_20 = ewma_vol(arr[-20:], 20) if len(arr) >= 20 else 0
        vol_60 = ewma_vol(arr[-60:], 60) if len(arr) >= 60 else 0

        # Ensemble forecast
        forecast = np.mean([v for v in [vol_10, vol_20, vol_60] if v > 0])

        return {
            "vol_forecast_annualised": round(float(forecast), 4),
            "ewma_10d": round(vol_10, 4),
            "ewma_20d": round(vol_20, 4),
            "ewma_60d": round(vol_60, 4),
            "current_realised_20d": round(float(np.std(arr[-20:]) * np.sqrt(252)), 4) if len(arr) >= 20 else None,
        }

    @BaseMCPServer.tool(
        "generate_signal",
        "Generate a composite trading signal for a symbol using all available features",
        {"symbol": {"type": "string"}},
    )
    async def generate_signal(self, symbol: str) -> dict[str, Any]:
        """Aggregate multiple model outputs into a single trading signal."""
        symbol = symbol.upper()

        # Collect cached model outputs
        technical = await cache_get(f"signal:technical:{symbol}") or {}
        fundamental = await cache_get(f"signal:fundamental:{symbol}") or {}
        sentiment = await cache_get(f"signal:sentiment:{symbol}") or {}
        ml_rank = await cache_get(f"signal:ml_rank:{symbol}") or {}

        scores = {
            "technical": technical.get("score", 0),
            "fundamental": fundamental.get("score", 0),
            "sentiment": sentiment.get("score", 0),
            "ml_rank": ml_rank.get("score", 0),
        }

        weights = {"technical": 0.30, "fundamental": 0.25, "sentiment": 0.20, "ml_rank": 0.25}
        composite = sum(scores[k] * weights[k] for k in scores)

        if composite > 50:
            signal = "strong_buy"
        elif composite > 20:
            signal = "buy"
        elif composite > -20:
            signal = "hold"
        elif composite > -50:
            signal = "sell"
        else:
            signal = "strong_sell"

        return {
            "symbol": symbol,
            "signal": signal,
            "composite_score": round(composite, 2),
            "component_scores": scores,
            "weights": weights,
        }
