import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "src/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // QA r2-3 + r3-2 — ban TOKEN-EQUIVALENT arbitrary-px escapes. Codemods
  // (PR #14, #15) migrated existing escapes to wired tokens, and PR R3-2
  // migrated the deferred long tail (10/11/14/18/24/26/30/32/34/40/42 px).
  // This rule prevents regressions. Design-intentional arbitrary px (e.g.
  // min-h-[44px] tap targets, h-[260px] chart heights, the 36px marketing
  // footer wordmark, and the 54px research-hero numeric) are still allowed
  // — only values with a clear token equivalent are banned.
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\btext-\\[(10|11|12|13|14|15|16|17|18|19|20|22|24|26|28|30|32|34|40|42|48)px\\]/]",
          message: "Use text-* token utilities (text-eyebrow, text-label, text-body-sm, text-body, text-numeric-md, text-h3, text-numeric-lg, text-h2, text-h1, text-numeric-hero, text-display-sm, text-display-md, text-display-lg) — these px values have wired tokens. See qa/reviews/UI-REMEDIATION-PLAN.md §0.",
        },
        {
          selector: "Literal[value=/\\b(p|pl|pr|pt|pb|px|py|m|ml|mr|mt|mb|mx|my|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset-x|inset-y)-\\[(2|4|6|8|12|16|20|24|32|40|48|64|96)px\\]/]",
          message: "Use spacing-* token utilities (gap-3, p-4, etc. — Tailwind defaults match the wired --space-* scale) — these px values have exact-token equivalents. See qa/reviews/UI-REMEDIATION-PLAN.md §0.",
        },
        {
          selector: "TemplateElement[value.raw=/\\btext-\\[(10|11|12|13|14|15|16|17|18|19|20|22|24|26|28|30|32|34|40|42|48)px\\]/]",
          message: "Use text-* token utilities — these px values have wired tokens.",
        },
        {
          selector: "TemplateElement[value.raw=/\\b(p|pl|pr|pt|pb|px|py|m|ml|mr|mt|mb|mx|my|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset-x|inset-y)-\\[(2|4|6|8|12|16|20|24|32|40|48|64|96)px\\]/]",
          message: "Use spacing-* token utilities — these px values have exact-token equivalents.",
        },
      ],
    },
  },
]);

export default eslintConfig;
