/**
 * AlphaDesk typography — Layer 1.5
 * ────────────────────────────────
 * Thin semantic wrappers over the `.t-*` classes in design-tokens.css.
 * Using these components gives role-clarity ("display", "eyebrow") at the
 * call site so pages read intentionally.
 */

export { default as Display } from "./Display";
export type { DisplayProps } from "./Display";

export { default as Eyebrow } from "./Eyebrow";
export type { EyebrowProps } from "./Eyebrow";

export { default as SerifEyebrow } from "./SerifEyebrow";
export type { SerifEyebrowProps } from "./SerifEyebrow";

export { default as SectionRule } from "./SectionRule";
export type { SectionRuleProps } from "./SectionRule";

export { default as Mono } from "./Mono";
export type { MonoProps, MonoSize } from "./Mono";
