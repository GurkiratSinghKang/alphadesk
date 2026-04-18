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
