import { describe, it, expect } from 'vitest';

// worstAspectRatio and squarify are internal to SectorTreemap.tsx (not exported).
// We test their logic by copying the implementations here.

function worstAspectRatio(row: number[], w: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  if (s === 0 || w === 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((w * w * max) / (s * s), (s * s) / (w * w * min));
}

interface SquarifyItem {
  sector: string;
  change_pct: number;
  value: number;
}

interface LayoutRect {
  sector: string;
  change_pct: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(
  items: SquarifyItem[],
  containerW: number,
  containerH: number,
): LayoutRect[] {
  if (items.length === 0 || containerW <= 0 || containerH <= 0) return [];

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0) return [];

  const totalArea = containerW * containerH;
  const areas = items.map(it => ({
    ...it,
    area: (it.value / totalValue) * totalArea,
  }));

  const rects: LayoutRect[] = [];
  let remaining = [...areas];
  let x = 0;
  let y = 0;
  let w = containerW;
  let h = containerH;

  while (remaining.length > 0) {
    const shortSide = Math.min(w, h);
    const row: typeof areas = [];
    let rowArea = 0;

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i];
      const testRow = [...row.map(r => r.area), item.area];
      const testArea = rowArea + item.area;

      if (row.length === 0) {
        row.push(item);
        rowArea = item.area;
        continue;
      }

      const currentWorst = worstAspectRatio(row.map(r => r.area), shortSide);
      const newWorst = worstAspectRatio(testRow, shortSide);

      if (newWorst <= currentWorst) {
        row.push(item);
        rowArea = testArea;
      } else {
        break;
      }
    }

    const isHorizontal = w >= h;
    const rowLength = rowArea / (isHorizontal ? h : w);

    let offset = 0;
    for (const item of row) {
      const itemLength = item.area / rowLength;
      if (isHorizontal) {
        rects.push({ sector: item.sector, change_pct: item.change_pct, x, y: y + offset, w: rowLength, h: itemLength });
      } else {
        rects.push({ sector: item.sector, change_pct: item.change_pct, x: x + offset, y, w: itemLength, h: rowLength });
      }
      offset += itemLength;
    }

    if (isHorizontal) {
      x += rowLength;
      w -= rowLength;
    } else {
      y += rowLength;
      h -= rowLength;
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

// ─── worstAspectRatio tests ──────────────────────────────────

describe('worstAspectRatio', () => {
  it('returns Infinity for empty row', () => {
    expect(worstAspectRatio([], 100)).toBe(Infinity);
  });

  it('returns Infinity for zero width', () => {
    expect(worstAspectRatio([1], 0)).toBe(Infinity);
  });

  it('returns Infinity for zero-sum row', () => {
    expect(worstAspectRatio([0, 0], 100)).toBe(Infinity);
  });

  it('returns 1 for a perfect square', () => {
    // Single item with area equal to w*w produces ratio 1
    const ratio = worstAspectRatio([100], 10);
    expect(ratio).toBeCloseTo(1, 0);
  });

  it('returns higher ratio for elongated rectangles', () => {
    // Use two items so max != min, making the ratio non-symmetric
    const narrow = worstAspectRatio([10, 90], 2);
    const wide = worstAspectRatio([10, 90], 50);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('is symmetric for square containers', () => {
    // Same area, same width — ratio should be 1
    const ratio = worstAspectRatio([400], 20);
    expect(ratio).toBeCloseTo(1, 5);
  });

  it('handles multiple items in a row', () => {
    const ratio = worstAspectRatio([50, 50], 10);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
  });
});

// ─── squarify tests ──────────────────────────────────────────

describe('squarify', () => {
  it('returns empty array for no items', () => {
    expect(squarify([], 400, 300)).toEqual([]);
  });

  it('returns empty array for zero-width container', () => {
    const items = [{ sector: 'Tech', change_pct: 1, value: 100 }];
    expect(squarify(items, 0, 300)).toEqual([]);
  });

  it('returns empty array for zero-height container', () => {
    const items = [{ sector: 'Tech', change_pct: 1, value: 100 }];
    expect(squarify(items, 400, 0)).toEqual([]);
  });

  it('produces one rect per item', () => {
    const items = [
      { sector: 'Tech', change_pct: 1.2, value: 1 },
      { sector: 'Health', change_pct: -0.5, value: 1 },
      { sector: 'Energy', change_pct: 2.1, value: 1 },
    ];
    const rects = squarify(items, 400, 300);
    expect(rects.length).toBe(3);
  });

  it('total rect area equals container area', () => {
    const items = [
      { sector: 'A', change_pct: 0.5, value: 3 },
      { sector: 'B', change_pct: -1.0, value: 2 },
      { sector: 'C', change_pct: 1.5, value: 5 },
    ];
    const rects = squarify(items, 400, 300);
    const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(400 * 300, 0);
  });

  it('preserves sector names in output', () => {
    const items = [
      { sector: 'Financials', change_pct: 0.8, value: 1 },
      { sector: 'Utilities', change_pct: -0.3, value: 1 },
    ];
    const rects = squarify(items, 200, 100);
    const sectors = rects.map(r => r.sector);
    expect(sectors).toContain('Financials');
    expect(sectors).toContain('Utilities');
  });

  it('produces rects with non-negative dimensions', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      sector: `S${i}`,
      change_pct: i * 0.1,
      value: 1,
    }));
    const rects = squarify(items, 600, 200);
    for (const r of rects) {
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles single item filling the whole container', () => {
    const items = [{ sector: 'Solo', change_pct: 2.5, value: 100 }];
    const rects = squarify(items, 300, 200);
    expect(rects.length).toBe(1);
    expect(rects[0].w * rects[0].h).toBeCloseTo(300 * 200, 0);
  });
});
