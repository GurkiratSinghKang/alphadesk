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
  // QA r3-3 + Batch F — type-safety + unused-var hardening.
  // Batch F (P1-05): elevate no-explicit-any to `error` so future ad-hoc
  // `any` annotations fail the lint gate. The no-unsafe-* family requires
  // type-aware linting; we enable it on src/**/*.{ts,tsx} only (NOT on the
  // config files themselves, which lack a tsconfig project). Set to `warn`
  // so we surface (but don't yet block on) unsafe member access / assignment
  // / call / return — those will be addressed in subsequent codemod
  // batches. Existing flagged sites are intentionally NOT fixed in this PR;
  // accept the noise burst on first enable.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
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
        // QA r4-2 — guard against amber-consumer copy-paste growth.
        // The token --amber-500 is DEPRECATED in favour of intent-specific
        // tokens (--state-warning, --state-info-time, --state-stale).
        // This rule warns when source files reference --amber-500 directly
        // so future edits are nudged to the right semantic token. The token
        // itself is still defined in design-tokens.css for backward compat.
        {
          selector: "Literal[value=/--amber-500/]",
          message: "Use --state-warning (semantic warn), --state-info-time (stale/time indicators), or --state-stale per intent. Direct --amber-500 is deprecated and will be removed once all consumers migrate.",
        },
        {
          selector: "TemplateElement[value.raw=/--amber-500/]",
          message: "Use --state-warning (semantic warn), --state-info-time (stale/time indicators), or --state-stale per intent. Direct --amber-500 is deprecated and will be removed once all consumers migrate.",
        },
        // Batch F (P1-12) — ban bare-verb button labels. Per the AlphaDesk
        // copy spec, action labels must be specific ("Save changes", "Cancel
        // edit") — bare verbs erode trust on a trading surface. Selector
        // matches a button element whose text node is a single bare verb.
        {
          selector: "JSXElement[openingElement.name.name='button'] > JSXText[value=/^\\s*(Save|Cancel|Submit|OK|Got it|Hide|Show|Clear)\\s*$/]",
          message: "Bare-verb button labels are banned. Use specific copy: 'Save changes', 'Cancel edit', 'Submit order', 'Hide details', etc. (Batch F / P1-12)",
        },
        // Batch F (P1-12) — broader catch for ANY arbitrary-px text size or
        // spacing utility. The earlier r2-3 / r3-2 rules listed only the
        // specific px values that already had token equivalents; this rule
        // is the absolute floor — ANY arbitrary px text/spacing utility is
        // banned, including non-integer values like `text-[12.5px]` or
        // `gap-[6px]`. Use token utilities (text-eyebrow, text-body-sm,
        // gap-2, etc.) — see qa/reviews/UI-REMEDIATION-PLAN.md.
        {
          selector: "Literal[value=/\\btext-\\[\\d+\\.?\\d*px\\]/]",
          message: "Arbitrary-px text size banned. Use token utilities: text-eyebrow (11px), text-body-sm (13px), text-body (14px), text-h3 (18px), text-h2 (24px), text-display-* etc. (Batch F / P1-12)",
        },
        {
          selector: "TemplateElement[value.raw=/\\btext-\\[\\d+\\.?\\d*px\\]/]",
          message: "Arbitrary-px text size banned. Use token utilities. (Batch F / P1-12)",
        },
        {
          selector: "Literal[value=/\\b(gap|p|m|space-y|space-x)-\\[\\d+px\\]/]",
          message: "Arbitrary-px spacing banned. Use token utilities (gap-1..gap-12, p-1..p-12, m-1..m-12, space-y-1..12). (Batch F / P1-12)",
        },
        {
          selector: "TemplateElement[value.raw=/\\b(gap|p|m|space-y|space-x)-\\[\\d+px\\]/]",
          message: "Arbitrary-px spacing banned. Use token utilities. (Batch F / P1-12)",
        },
        // QA r6-2 — ban off-system Tailwind palette utilities. The R5
        // audit found that the prior --amber-500 guard (above) only caught
        // the CSS-var form; Tailwind utility forms like ``text-amber-100``,
        // ``bg-emerald-500/10``, ``border-red-500/40`` were sneaking in
        // because they bypass the design-token resolver entirely. The
        // selector matches both bare class names and class-string fragments
        // (start-of-string OR whitespace boundary).
        //
        // Allowed: slate / zinc / neutral / stone (Tailwind grays — these
        // are legitimate utility chrome and don't carry chroma intent).
        // Banned: amber, emerald, red, blue, green, purple, pink, cyan,
        // teal, indigo, violet, orange, fuchsia, rose, lime, sky, yellow.
        // Use AlphaDesk semantic tokens instead: state-warning / state-warning-fg
        // (warn), state-info-time (stale), profit / loss (P&L), brand
        // (gold accent), ink-* (warm grays), gold-* (brand), up-* / down-*
        // (P&L variants).
        {
          selector: "Literal[value=/(^|\\s)(text|bg|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|caret|accent|decoration|shadow)-(amber|emerald|red|blue|green|purple|pink|cyan|teal|indigo|violet|orange|fuchsia|rose|lime|sky|yellow)-(50|100|200|300|400|500|600|700|800|900|950)/]",
          message: "Off-system Tailwind palette banned. Use AlphaDesk semantic tokens: state-warning, state-info-time, profit, loss, brand, ink-*, gold-*, up-*, down-*. (R6-2)",
        },
        {
          selector: "TemplateElement[value.raw=/(^|\\s)(text|bg|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|caret|accent|decoration|shadow)-(amber|emerald|red|blue|green|purple|pink|cyan|teal|indigo|violet|orange|fuchsia|rose|lime|sky|yellow)-(50|100|200|300|400|500|600|700|800|900|950)/]",
          message: "Off-system Tailwind palette banned. Use AlphaDesk semantic tokens: state-warning, state-info-time, profit, loss, brand, ink-*, gold-*, up-*, down-*. (R6-2)",
        },
      ],
    },
  },
]);

export default eslintConfig;
