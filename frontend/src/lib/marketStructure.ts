import type { OHLCVBar } from "@/types";

export type StructureZoneKind = "support" | "resistance";
export type OrderBlockKind = "demand" | "supply";
export type OrderBlockStatus = "active" | "mitigated" | "invalidated";

export interface VolumeProfileBin {
  lower: number;
  upper: number;
  mid: number;
  volume: number;
  volumeShare: number;
  isPoc: boolean;
  inValueArea: boolean;
}

export interface SupportResistanceZone {
  id: string;
  kind: StructureZoneKind;
  lower: number;
  upper: number;
  mid: number;
  strength: number;
  touches: number;
  source: "swing" | "volume" | "mixed";
  lastTouchedIndex: number;
}

export interface OrderBlockZone {
  id: string;
  kind: OrderBlockKind;
  lower: number;
  upper: number;
  originIndex: number;
  originTime: number;
  endTime: number;
  strength: number;
  relativeVolume: number;
  status: OrderBlockStatus;
}

export interface MarketStructureMap {
  atr: number;
  hasVolume: boolean;
  profile: VolumeProfileBin[];
  zones: SupportResistanceZone[];
  orderBlocks: OrderBlockZone[];
}

interface CandidateLevel {
  kind: StructureZoneKind;
  price: number;
  weight: number;
  source: "swing" | "volume";
  index: number;
}

interface ClusteredLevel {
  kind: StructureZoneKind;
  weightedPrice: number;
  totalWeight: number;
  count: number;
  sources: Set<"swing" | "volume">;
  lastIndex: number;
}

const DEFAULT_BIN_COUNT = 32;
const DEFAULT_VALUE_AREA = 0.7;

function finiteBars(bars: OHLCVBar[]): OHLCVBar[] {
  return bars.filter((b) =>
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close) &&
    b.high >= b.low &&
    b.high > 0 &&
    b.low > 0,
  );
}

export function computeAtr(bars: OHLCVBar[], period = 14): number {
  const clean = finiteBars(bars);
  if (clean.length < 2) {
    const only = clean[0];
    return only ? Math.max(only.high - only.low, only.close * 0.005) : 1;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prevClose = clean[i - 1].close;
    trueRanges.push(Math.max(
      clean[i].high - clean[i].low,
      Math.abs(clean[i].high - prevClose),
      Math.abs(clean[i].low - prevClose),
    ));
  }

  const slice = trueRanges.slice(-period);
  const avg = slice.reduce((sum, v) => sum + v, 0) / Math.max(1, slice.length);
  const last = clean[clean.length - 1]?.close ?? 1;
  return Math.max(avg, last * 0.0025, 0.01);
}

export function calculateVolumeProfile(
  bars: OHLCVBar[],
  binCount = DEFAULT_BIN_COUNT,
  valueAreaPct = DEFAULT_VALUE_AREA,
): VolumeProfileBin[] {
  const clean = finiteBars(bars);
  if (clean.length === 0 || binCount < 4) return [];

  const lo = Math.min(...clean.map((b) => b.low));
  const hi = Math.max(...clean.map((b) => b.high));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];

  const totalInputVolume = clean.reduce((sum, b) => sum + Math.max(0, b.volume ?? 0), 0);
  if (totalInputVolume <= 0) return [];

  const range = hi - lo;
  const binSize = range / binCount;
  const volumes = new Array<number>(binCount).fill(0);

  for (const bar of clean) {
    const start = Math.max(0, Math.min(binCount - 1, Math.floor((bar.low - lo) / binSize)));
    const end = Math.max(0, Math.min(binCount - 1, Math.floor((bar.high - lo) / binSize)));
    const n = end - start + 1;
    if (n <= 0) continue;
    const perBin = Math.max(0, bar.volume ?? 0) / n;
    for (let i = start; i <= end; i++) volumes[i] += perBin;
  }

  const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
  if (totalVolume <= 0) return [];

  let pocIdx = 0;
  let pocVol = -Infinity;
  volumes.forEach((v, i) => {
    if (v > pocVol) {
      pocVol = v;
      pocIdx = i;
    }
  });

  let captured = volumes[pocIdx];
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  const target = totalVolume * Math.max(0.1, Math.min(0.95, valueAreaPct));
  while (captured < target && (lowIdx > 0 || highIdx < binCount - 1)) {
    const lowNext = lowIdx > 0 ? volumes[lowIdx - 1] : -Infinity;
    const highNext = highIdx < binCount - 1 ? volumes[highIdx + 1] : -Infinity;
    if (lowNext > highNext) {
      lowIdx--;
      captured += lowNext;
    } else {
      highIdx++;
      captured += highNext;
    }
  }

  return volumes.map((volume, i) => {
    const lower = lo + i * binSize;
    const upper = lower + binSize;
    return {
      lower,
      upper,
      mid: (lower + upper) / 2,
      volume,
      volumeShare: volume / totalVolume,
      isPoc: i === pocIdx,
      inValueArea: i >= lowIdx && i <= highIdx,
    };
  });
}

function averageVolumeBefore(bars: OHLCVBar[], index: number, lookback = 20): number {
  const start = Math.max(0, index - lookback);
  const slice = bars.slice(start, index);
  const usable = slice.filter((b) => (b.volume ?? 0) > 0);
  if (usable.length === 0) return 0;
  return usable.reduce((sum, b) => sum + b.volume, 0) / usable.length;
}

function countTouches(bars: OHLCVBar[], lower: number, upper: number): { touches: number; lastIndex: number } {
  let touches = 0;
  let lastIndex = -1;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const intersects = bar.low <= upper && bar.high >= lower;
    if (!intersects) continue;
    touches++;
    lastIndex = i;
  }
  return { touches, lastIndex };
}

function clusterLevels(candidates: CandidateLevel[], tolerance: number): ClusteredLevel[] {
  const sorted = [...candidates].sort((a, b) =>
    a.kind === b.kind ? a.price - b.price : a.kind.localeCompare(b.kind),
  );
  const clusters: ClusteredLevel[] = [];

  for (const candidate of sorted) {
    const previous = clusters[clusters.length - 1];
    const previousMid = previous ? previous.weightedPrice / previous.totalWeight : 0;
    if (
      previous &&
      previous.kind === candidate.kind &&
      Math.abs(candidate.price - previousMid) <= tolerance
    ) {
      previous.weightedPrice += candidate.price * candidate.weight;
      previous.totalWeight += candidate.weight;
      previous.count += 1;
      previous.sources.add(candidate.source);
      previous.lastIndex = Math.max(previous.lastIndex, candidate.index);
      continue;
    }
    clusters.push({
      kind: candidate.kind,
      weightedPrice: candidate.price * candidate.weight,
      totalWeight: candidate.weight,
      count: 1,
      sources: new Set([candidate.source]),
      lastIndex: candidate.index,
    });
  }

  return clusters;
}

export function deriveSupportResistanceZones(
  bars: OHLCVBar[],
  options: { maxZones?: number; binCount?: number; atr?: number } = {},
): SupportResistanceZone[] {
  const clean = finiteBars(bars);
  if (clean.length < 8) return [];

  const current = clean[clean.length - 1].close;
  const atr = options.atr ?? computeAtr(clean);
  const tolerance = Math.max(atr * 0.38, current * 0.0025);
  const candidates: CandidateLevel[] = [];

  for (let i = 2; i < clean.length - 2; i++) {
    const bar = clean[i];
    const avgVol = averageVolumeBefore(clean, i);
    const volumeBoost = avgVol > 0 ? Math.min(2, Math.max(0, bar.volume / avgVol - 1)) : 0;
    if (
      bar.low <= clean[i - 1].low &&
      bar.low <= clean[i - 2].low &&
      bar.low <= clean[i + 1].low &&
      bar.low <= clean[i + 2].low
    ) {
      candidates.push({
        kind: "support",
        price: bar.low,
        weight: 1.25 + volumeBoost,
        source: "swing",
        index: i,
      });
    }
    if (
      bar.high >= clean[i - 1].high &&
      bar.high >= clean[i - 2].high &&
      bar.high >= clean[i + 1].high &&
      bar.high >= clean[i + 2].high
    ) {
      candidates.push({
        kind: "resistance",
        price: bar.high,
        weight: 1.25 + volumeBoost,
        source: "swing",
        index: i,
      });
    }
  }

  const profile = calculateVolumeProfile(clean, options.binCount ?? DEFAULT_BIN_COUNT);
  const profileVolumes = profile.map((b) => b.volume).sort((a, b) => a - b);
  const highVolumeCutoff = profileVolumes[Math.floor(profileVolumes.length * 0.72)] ?? Infinity;
  for (const bin of profile) {
    if (bin.volume < highVolumeCutoff && !bin.isPoc) continue;
    candidates.push({
      kind: bin.mid <= current ? "support" : "resistance",
      price: bin.mid,
      weight: bin.isPoc ? 3.25 : 2 + bin.volumeShare * 20,
      source: "volume",
      index: clean.length - 1,
    });
  }

  const zones = clusterLevels(candidates, tolerance * 1.4)
    .map((cluster, i): SupportResistanceZone => {
      const mid = cluster.weightedPrice / cluster.totalWeight;
      const lower = mid - tolerance;
      const upper = mid + tolerance;
      const { touches, lastIndex } = countTouches(clean, lower, upper);
      const recency = lastIndex >= 0 ? lastIndex / Math.max(1, clean.length - 1) : 0;
      const source = cluster.sources.size > 1
        ? "mixed"
        : cluster.sources.has("volume")
          ? "volume"
          : "swing";
      const confluence = source === "mixed" ? 18 : source === "volume" ? 10 : 6;
      const strength = Math.min(
        100,
        Math.round(cluster.totalWeight * 11 + touches * 6 + recency * 10 + confluence),
      );
      return {
        id: `${cluster.kind}-${i}-${Math.round(mid * 100)}`,
        kind: cluster.kind,
        lower,
        upper,
        mid,
        strength,
        touches,
        source,
        lastTouchedIndex: lastIndex,
      };
    })
    .filter((z) => z.touches >= 2);

  const maxZones = options.maxZones ?? 6;
  const supports = zones
    .filter((z) => z.kind === "support" && z.mid <= current + tolerance)
    .sort((a, b) => b.strength - a.strength || Math.abs(a.mid - current) - Math.abs(b.mid - current))
    .slice(0, Math.ceil(maxZones / 2));
  const resistances = zones
    .filter((z) => z.kind === "resistance" && z.mid >= current - tolerance)
    .sort((a, b) => b.strength - a.strength || Math.abs(a.mid - current) - Math.abs(b.mid - current))
    .slice(0, Math.floor(maxZones / 2));

  return [...supports, ...resistances].sort((a, b) => a.mid - b.mid);
}

export function detectOrderBlocks(
  bars: OHLCVBar[],
  options: { maxBlocks?: number; atr?: number; minRelativeVolume?: number } = {},
): OrderBlockZone[] {
  const clean = finiteBars(bars);
  if (clean.length < 24 || clean.every((b) => (b.volume ?? 0) <= 0)) return [];

  const atr = options.atr ?? computeAtr(clean);
  const minRelativeVolume = options.minRelativeVolume ?? 1.35;
  const latest = clean[clean.length - 1];
  const candidates: OrderBlockZone[] = [];

  for (let i = 20; i < clean.length - 3; i++) {
    const bar = clean[i];
    const avgVol = averageVolumeBefore(clean, i);
    if (avgVol <= 0) continue;
    const relativeVolume = bar.volume / avgVol;
    if (relativeVolume < minRelativeVolume) continue;

    const forwardClose = clean[Math.min(clean.length - 1, i + 3)].close;
    const displacement = forwardClose - bar.close;
    const range = Math.max(bar.high - bar.low, 0.01);
    const largeEnough = range >= atr * 0.25 || Math.abs(displacement) >= atr * 0.75;
    if (!largeEnough) continue;

    const demand = displacement > atr * 0.55;
    const supply = displacement < -atr * 0.55;
    if (!demand && !supply) continue;

    const kind: OrderBlockKind = demand ? "demand" : "supply";
    const bodyLow = Math.min(bar.open, bar.close);
    const bodyHigh = Math.max(bar.open, bar.close);
    const lower = kind === "demand" ? bar.low : bodyLow;
    const upper = kind === "demand" ? bodyHigh : bar.high;
    const invalidated = kind === "demand" ? latest.close < lower : latest.close > upper;
    let revisited = false;
    for (let j = i + 1; j < clean.length; j++) {
      if (clean[j].low <= upper && clean[j].high >= lower) {
        revisited = true;
        break;
      }
    }
    const status: OrderBlockStatus = invalidated ? "invalidated" : revisited ? "mitigated" : "active";
    const recency = i / Math.max(1, clean.length - 1);
    const strength = Math.min(
      100,
      Math.round(relativeVolume * 22 + Math.abs(displacement / atr) * 16 + recency * 12),
    );

    candidates.push({
      id: `${kind}-${i}-${Math.round(lower * 100)}-${Math.round(upper * 100)}`,
      kind,
      lower,
      upper,
      originIndex: i,
      originTime: clean[i].time,
      endTime: latest.time,
      strength,
      relativeVolume,
      status,
    });
  }

  const maxBlocks = options.maxBlocks ?? 4;
  const activeFirst = candidates.sort((a, b) => {
    const statusScore = (z: OrderBlockZone) =>
      z.status === "active" ? 2 : z.status === "mitigated" ? 1 : 0;
    const distanceA = Math.abs((a.lower + a.upper) / 2 - latest.close);
    const distanceB = Math.abs((b.lower + b.upper) / 2 - latest.close);
    return statusScore(b) - statusScore(a) || b.strength - a.strength || distanceA - distanceB;
  });

  return activeFirst
    .filter((b) => b.status !== "invalidated")
    .slice(0, maxBlocks)
    .sort((a, b) => a.originIndex - b.originIndex);
}

export function deriveMarketStructure(
  bars: OHLCVBar[],
  options: { maxZones?: number; maxBlocks?: number; binCount?: number } = {},
): MarketStructureMap {
  const clean = finiteBars(bars);
  const atr = computeAtr(clean);
  const hasVolume = clean.some((b) => (b.volume ?? 0) > 0);
  return {
    atr,
    hasVolume,
    profile: calculateVolumeProfile(clean, options.binCount ?? DEFAULT_BIN_COUNT),
    zones: deriveSupportResistanceZones(clean, {
      maxZones: options.maxZones ?? 6,
      binCount: options.binCount ?? DEFAULT_BIN_COUNT,
      atr,
    }),
    orderBlocks: detectOrderBlocks(clean, {
      maxBlocks: options.maxBlocks ?? 3,
      atr,
    }),
  };
}
