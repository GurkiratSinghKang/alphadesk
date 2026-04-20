import '@testing-library/jest-dom';

// jsdom polyfills for browser APIs some of our deps (e.g. @base-ui/react's
// ScrollAreaViewport) call on Elements. Missing APIs throw as unhandled
// errors that fail vitest CI even when all test assertions pass locally.
if (typeof Element !== 'undefined' && !('getAnimations' in Element.prototype)) {
  (Element.prototype as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [];
}
if (typeof Element !== 'undefined' && !('animate' in Element.prototype)) {
  (Element.prototype as unknown as { animate: () => { cancel: () => void; finish: () => void } }).animate = () => ({
    cancel() {},
    finish() {},
  });
}

// 2026-04-20 dashboard redesign: ChartPane → TradingChart attaches a
// ResizeObserver so the canvas resizes with its container. jsdom has no
// RO — tests that mount the chart (PriceChartPanel, ChartPane) crashed
// with `ResizeObserver is not defined` until this polyfill was added at
// global setup level. The shim in setup-mocks.ts only loads for tests
// that explicitly import it; this line is the unconditional fallback.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
