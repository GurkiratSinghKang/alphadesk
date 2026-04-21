/**
 * Lightweight-charts v5 drawing primitive. Renders trend lines, rectangles,
 * and fibonacci retracements via Series Primitives (priceToCoordinate anchors
 * the shapes to the main series). Render-only in v1; click-to-draw / editing
 * deferred to v2.
 */
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

// ─── Public types ────────────────────────────────────────────

export type DrawingKind = "trend" | "rect" | "fib" | "horizontal";

export interface DrawingPoint {
  /** Unix seconds (matches LWC v5 `Time` when used as number). */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /**
   * trend / rect / fib: 2 points.
   * horizontal: 1 point — the price level; the line is drawn across the
   * full visible bitmap width so it tracks the chart as the user pans.
   */
  points: DrawingPoint[];
  /** CSS color token value (already resolved to a usable color string). */
  color: string;
  createdAt: number;
}

export interface DrawingPaneHandle {
  setDrawings(drawings: Drawing[]): void;
  detach(): void;
}

// ─── Fibonacci levels ────────────────────────────────────────

const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

// ─── Token helpers (client-safe) ─────────────────────────────

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fallback;
  } catch {
    return fallback;
  }
}

// ─── Renderer ────────────────────────────────────────────────

class DrawingRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly drawings: readonly Drawing[],
    private readonly series: ISeriesApi<SeriesType>,
    private readonly chart: IChartApi,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hPx = scope.horizontalPixelRatio;
      const vPx = scope.verticalPixelRatio;
      const timeScale = this.chart.timeScale();

      for (const d of this.drawings) {
        if (!d.points || d.points.length < 1) continue;
        const p1 = d.points[0];

        // Horizontal line: only one anchor point — draw across full width.
        if (d.kind === "horizontal") {
          const y = this.series.priceToCoordinate(p1.price);
          if (y == null) continue;
          drawHorizontal(ctx, y * vPx, d.color, scope.bitmapSize.width, hPx, vPx, p1.price);
          continue;
        }

        if (d.points.length < 2) continue;
        const p2 = d.points[1];
        // Convert to media-coordinate pixels first.
        const x1 = timeScale.timeToCoordinate(p1.time as unknown as Time);
        const x2 = timeScale.timeToCoordinate(p2.time as unknown as Time);
        const y1 = this.series.priceToCoordinate(p1.price);
        const y2 = this.series.priceToCoordinate(p2.price);
        // Skip silently when any coord falls off-screen (null). The time-scale
        // returns null for times outside the current visible range, and
        // priceToCoordinate returns null before the series has data.
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;

        // Scale media → bitmap for the rendering context.
        const bx1 = x1 * hPx;
        const bx2 = x2 * hPx;
        const by1 = y1 * vPx;
        const by2 = y2 * vPx;

        if (d.kind === "trend") {
          drawTrend(ctx, bx1, by1, bx2, by2, d.color, hPx);
        } else if (d.kind === "rect") {
          drawRect(ctx, bx1, by1, bx2, by2, d.color, p2.price - p1.price, hPx);
        } else if (d.kind === "fib") {
          drawFib(ctx, bx1, by1, bx2, by2, d.color, p1.price, p2.price, hPx, vPx, scope.bitmapSize.width);
        }
      }
    });
  }
}

// ─── Shape helpers ───────────────────────────────────────────

function drawTrend(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  hPx: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * hPx;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawHorizontal(
  ctx: CanvasRenderingContext2D,
  y: number,
  color: string,
  bitmapWidth: number,
  hPx: number,
  vPx: number,
  price: number,
): void {
  // Stretches edge-to-edge so the line keeps reading as a price level when
  // the user pans. Price label sits on the right so it doesn't collide
  // with the axis labels on the outer edge of the canvas.
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * hPx;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(bitmapWidth, y);
  ctx.stroke();
  ctx.font = `${10 * vPx}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.fillText(price.toFixed(2), bitmapWidth - 6 * hPx, y - 2 * vPx);
  ctx.restore();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fallbackColor: string,
  priceDelta: number,
  hPx: number,
): void {
  // Directional tint: upward selection uses up-500, downward uses down-500.
  // The rectangle is a zone of interest so the sign carries meaning.
  const up = readToken("--up-500", "#a8d04d");
  const down = readToken("--down-500", "#e07856");
  const stroke = priceDelta >= 0 ? up : down;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  ctx.save();
  ctx.fillStyle = withAlpha(stroke, 0.1) ?? fallbackColor;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5 * hPx;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawFib(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  price1: number,
  price2: number,
  hPx: number,
  vPx: number,
  bitmapWidth: number,
): void {
  // Horizontal lines at each FIB level, bounded between the two anchor
  // x-coords, with a ratio label on the right edge of the chart.
  const leftX = Math.min(x1, x2);
  const rightX = Math.max(x1, x2);
  const priceDelta = price2 - price1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * hPx;
  ctx.setLineDash([4 * hPx, 3 * hPx]);
  ctx.font = `${10 * vPx}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  for (const level of FIB_LEVELS) {
    const levelPrice = price1 + priceDelta * level;
    // Re-derive y from price via a fraction between y1 and y2 — avoids
    // re-calling priceToCoordinate per level (and matches user's anchor).
    const fraction = priceDelta === 0 ? 0 : (levelPrice - price1) / priceDelta;
    const ly = y1 + (y2 - y1) * fraction;
    ctx.beginPath();
    ctx.moveTo(leftX, ly);
    ctx.lineTo(rightX, ly);
    ctx.stroke();
    // Ratio label at right edge of chart canvas (with small inset).
    const labelX = Math.min(rightX + 4 * hPx, bitmapWidth - 40 * hPx);
    ctx.fillText(level.toFixed(3), labelX, ly);
  }
  ctx.restore();
}

// ─── Color util ──────────────────────────────────────────────

/** Convert common CSS colors to rgba() with the given alpha. Returns null
 *  on an unrecognized format so the caller can fall back. */
function withAlpha(color: string, alpha: number): string | null {
  const c = color.trim();
  // #rgb, #rrggbb
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return null;
}

// ─── Pane view ───────────────────────────────────────────────

class DrawingPaneView implements IPrimitivePaneView {
  constructor(
    private readonly getDrawings: () => readonly Drawing[],
    private readonly series: ISeriesApi<SeriesType>,
    private readonly chart: IChartApi,
  ) {}

  renderer(): IPrimitivePaneRenderer | null {
    return new DrawingRenderer(this.getDrawings(), this.series, this.chart);
  }
}

// ─── Primitive ───────────────────────────────────────────────

class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private _drawings: readonly Drawing[];
  private readonly _views: readonly IPrimitivePaneView[];
  private _requestUpdate: (() => void) | null = null;

  constructor(
    initial: readonly Drawing[],
    series: ISeriesApi<SeriesType>,
    chart: IChartApi,
  ) {
    this._drawings = initial;
    this._views = [new DrawingPaneView(() => this._drawings, series, chart)];
  }

  attached(param: { requestUpdate: () => void }): void {
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }

  setDrawings(next: readonly Drawing[]): void {
    this._drawings = next;
    this._requestUpdate?.();
  }
}

// ─── Public factory ──────────────────────────────────────────

export function attachDrawingPane(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  initial: Drawing[],
): DrawingPaneHandle {
  const primitive = new DrawingPrimitive(initial, series, chart);
  series.attachPrimitive(primitive);
  let attached = true;
  return {
    setDrawings(next: Drawing[]): void {
      if (!attached) return;
      primitive.setDrawings(next);
    },
    detach(): void {
      if (!attached) return;
      attached = false;
      try {
        series.detachPrimitive(primitive);
      } catch {
        // series may have been removed already
      }
    },
  };
}
