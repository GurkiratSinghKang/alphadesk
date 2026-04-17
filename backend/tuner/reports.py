"""Per-study tuning report generation.

Given a completed Optuna study, :func:`write_report` produces a Markdown
document at a caller-supplied path containing:

- the best parameters and score,
- Sharpe by fold (when k-fold results are available),
- parameter sensitivity via partial-dependence (Optuna's built-in),
- a convergence trace (best-value-so-far per trial).

The plotting helpers are optional: if ``matplotlib`` is not installed, the
report is written without figures and a note is included.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional

try:
    import optuna
except ImportError:  # pragma: no cover
    optuna = None  # type: ignore[assignment]

try:
    import matplotlib

    matplotlib.use("Agg", force=True)
    import matplotlib.pyplot as plt
except Exception:  # pragma: no cover - optional dep
    plt = None  # type: ignore[assignment]

log = logging.getLogger("alphadesk.tuner.reports")


@dataclass
class ReportBundle:
    """Output of :func:`write_report`."""

    markdown_path: str
    figures: list[str]


def write_report(
    study: "optuna.Study",
    out_dir: str | os.PathLike[str],
    *,
    strategy_name: str = "",
    fold_metrics: Optional[list[Mapping[str, float]]] = None,
    extra_sections: Optional[Mapping[str, str]] = None,
) -> ReportBundle:
    """Write a Markdown study report under ``out_dir``.

    Parameters
    ----------
    study:
        The completed Optuna study.
    out_dir:
        Directory to write ``report.md`` (and any figures) into; created if
        missing.
    strategy_name:
        Strategy name for the report heading.
    fold_metrics:
        Optional per-fold metrics. When present, the "Sharpe by fold"
        section is populated from this list.
    extra_sections:
        Optional ``{heading: markdown_body}`` to append verbatim.
    """

    if optuna is None:  # pragma: no cover
        raise RuntimeError("optuna is not installed.")

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    figures: list[str] = []
    md_lines: list[str] = []

    md_lines.append(f"# Tuner report: {strategy_name or study.study_name}")
    md_lines.append("")
    md_lines.append(f"- Study name: `{study.study_name}`")
    md_lines.append(f"- Direction: `{study.direction.name.lower()}`")
    md_lines.append(f"- Trials: {len(study.trials)}")
    try:
        md_lines.append(f"- Best value: `{study.best_value:.6f}`")
    except ValueError:
        md_lines.append("- Best value: *(no completed trials)*")
    md_lines.append("")

    # Best params table -----------------------------------------------------
    md_lines.append("## Best parameters")
    md_lines.append("")
    try:
        best = study.best_params
    except ValueError:
        best = {}
    if best:
        md_lines.append("| Parameter | Value |")
        md_lines.append("|---|---|")
        for k, v in sorted(best.items()):
            md_lines.append(f"| `{k}` | `{_fmt(v)}` |")
    else:
        md_lines.append("*no successful trials*")
    md_lines.append("")

    # Sharpe by fold --------------------------------------------------------
    md_lines.append("## Sharpe by fold")
    md_lines.append("")
    if fold_metrics:
        md_lines.append("| Fold | Sharpe | MaxDD | Turnover |")
        md_lines.append("|---:|---:|---:|---:|")
        for i, m in enumerate(fold_metrics):
            md_lines.append(
                f"| {i} | {_fmt(m.get('sharpe'))} | {_fmt(m.get('max_drawdown'))} | {_fmt(m.get('turnover'))} |"
            )
    else:
        md_lines.append("*fold-level metrics not supplied.*")
    md_lines.append("")

    # Convergence plot ------------------------------------------------------
    md_lines.append("## Convergence")
    md_lines.append("")
    conv_path = _save_convergence(study, out)
    if conv_path:
        figures.append(conv_path)
        md_lines.append(f"![convergence]({Path(conv_path).name})")
    else:
        md_lines.append(
            "*matplotlib not installed; convergence plot skipped.*"
        )
    md_lines.append("")

    # Parameter sensitivity (partial dependence) ----------------------------
    md_lines.append("## Parameter sensitivity (importance)")
    md_lines.append("")
    importances = _param_importances(study)
    if importances:
        md_lines.append("| Parameter | Importance |")
        md_lines.append("|---|---:|")
        for k, v in sorted(importances.items(), key=lambda kv: -kv[1]):
            md_lines.append(f"| `{k}` | {v:.4f} |")
    else:
        md_lines.append("*importance scores unavailable (need >= 2 completed trials).*")
    md_lines.append("")

    pd_path = _save_partial_dependence(study, out)
    if pd_path:
        figures.append(pd_path)
        md_lines.append(f"![partial-dependence]({Path(pd_path).name})")
        md_lines.append("")

    # Extras ----------------------------------------------------------------
    if extra_sections:
        for heading, body in extra_sections.items():
            md_lines.append(f"## {heading}")
            md_lines.append("")
            md_lines.append(body.rstrip("\n"))
            md_lines.append("")

    md_path = out / "report.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    return ReportBundle(markdown_path=str(md_path), figures=figures)


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)


def _save_convergence(study: "optuna.Study", out_dir: Path) -> str | None:
    if plt is None:
        return None
    completed = [
        t for t in study.trials if t.value is not None and t.state.is_finished()
    ]
    if len(completed) < 2:
        return None
    values = [t.value for t in completed]
    best_so_far = []
    cur = float("-inf") if study.direction.name == "MAXIMIZE" else float("inf")
    for v in values:
        if study.direction.name == "MAXIMIZE":
            cur = max(cur, v)
        else:
            cur = min(cur, v)
        best_so_far.append(cur)

    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.plot(range(len(values)), values, "o", alpha=0.4, label="trial")
    ax.plot(range(len(best_so_far)), best_so_far, "-", label="best so far")
    ax.set_xlabel("trial")
    ax.set_ylabel("objective")
    ax.set_title("Convergence")
    ax.legend()
    ax.grid(True, alpha=0.25)
    fig.tight_layout()

    path = out_dir / "convergence.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return str(path)


def _param_importances(study: "optuna.Study") -> dict[str, float]:
    """Wrap :func:`optuna.importance.get_param_importances` with a safe fallback."""

    try:
        return dict(optuna.importance.get_param_importances(study))
    except Exception as exc:
        log.debug("importance calc failed: %s", exc)
        return {}


def _save_partial_dependence(study: "optuna.Study", out_dir: Path) -> str | None:
    """Best-effort partial dependence plot.

    Uses Optuna's Matplotlib visualisation module. When the dependency isn't
    available or too few trials are present, returns ``None``.
    """

    if plt is None:
        return None
    try:
        from optuna.visualization.matplotlib import plot_contour
    except Exception:
        return None

    completed = [t for t in study.trials if t.value is not None]
    if len(completed) < 4:
        return None
    try:
        ax = plot_contour(study)
    except Exception as exc:
        log.debug("plot_contour failed: %s", exc)
        return None
    fig = ax.figure if hasattr(ax, "figure") else plt.gcf()
    fig.set_size_inches(8, 6)
    path = out_dir / "partial_dependence.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return str(path)


__all__ = ["write_report", "ReportBundle"]
