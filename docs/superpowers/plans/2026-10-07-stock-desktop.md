# Chrome Stock Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver an installable Traditional Chinese Chrome new-tab stock dashboard for Taiwan and US stocks with personal cost basis, groups, threshold notifications, and ten attributed CC0 backgrounds.

**Architecture:** React foreground reads and edits locally persisted state; a single Manifest V3 background worker owns quote refresh and alert evaluation. Provider adapters normalize real quotes; pure functions calculate gains and threshold transitions. Built-in photos are bundled, while user uploads stay in IndexedDB.

**Tech Stack:** TypeScript, React, Vite, Vitest, Playwright, Chrome MV3 storage/alarms/notifications.

The approved design is `docs/superpowers/specs/2026-10-07-stock-desktop-design.md`. There is no Git repository; work in this workspace and do not initialize Git, commit, publish, or deploy. Keep AGENTS.md intact. Implementation and review use gpt-6-luna/xhigh.

## File boundaries

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`: commands, strict typing, UI and worker build entries.
- `public/manifest.json`, `public/icons/*`, `public/backgrounds/*`: extension metadata and bundled assets.
- `src/domain/types.ts`, `src/domain/portfolio.ts`, `src/domain/alerts.ts`: versioned state, validation, gain calculations, pure threshold transitions.
- `src/data/storage.ts`, `src/data/backgrounds.ts`, `src/data/images.ts`: local persistence, sourced photo catalog, custom image IndexedDB.
- `src/providers/fugle.ts`, `src/providers/finnhub.ts`, `src/providers/quotes.ts`: provider contracts, normalized quotes, classified failures.
- `src/background/worker.ts`, `src/background/scheduler.ts`: serialized mutations, global refresh scheduling and notification delivery.
- `src/App.tsx`, `src/components/*`, `src/styles.css`, `src/main.tsx`: dashboard, accessible dialogs, stock/group forms, settings and background picker.
- `tests/*.test.ts`, `tests/e2e/*.spec.ts`: finance and alert invariants, provider normalization, persistence and visible extension flows.
- `README.md`, `THIRD_PARTY_NOTICES.md`: Chinese setup instructions, API key setup, limitations and photo credits.

## Task 1: Scaffold and domain model

- [x] Create npm commands `dev`, `build`, `typecheck`, `test`, `test:e2e`; install local dependencies and a lockfile. Build MV3 `newtab.html` (or `index.html`) and `background.js` with no remote executable code.
- [x] Define stock ID independently of provider symbol; stock fields include market, symbol, name, groupId, optional cost/quantity, display mode and separate above/below rules. Group IDs and orders are stable. Quote fields include currency, price, prior close, provider timestamp, market status and fetch status. Persist versioned app state and alert latches separately from secrets.
- [x] Write and run failing finance/validation tests, then implement the domain behavior. Examples:

```ts
expect(calculateGain(110, 100, 5)).toEqual({ percent: 10, amount: 50, perShare: false });
expect(calculateGain(90, 100)).toEqual({ percent: -10, amount: -10, perShare: true });
expect(calculateGain(101, 100, 0.5).amount).toBe(0.5);
```

- [x] Validate finite positive costs/quantities/thresholds and lower < upper; normalize US symbols to uppercase while preserving legitimate punctuation and Taiwan leading zeros. Prevent malformed symbols before issuing requests.
- [x] Verify `npm test -- --run` and `npm run typecheck` for this module.

## Task 2: Pure alert rules, storage and worker

- [x] Write failing tests with quote sequences 99 → 100 → 101 → 102 → 100 → 101 for an above-100 rule: two notifications, none at equality, no repeated notification while continuously true.
- [ ] Test a first valid matching quote, separate below rules, rule edits, disabled rules, duplicate/out-of-order timestamps, stale (>120 seconds) or future timestamps, invalid prices, persisted worker restart state and notification delivery failures.
- [x] Implement a pure transition returning next latch and optional event. Failed/stale quotes must not reset the latch. Reset only on a valid fresh nonmatching quote or an explicit rule edit; persist deduplication state before delivery.
- [x] Implement serialized worker messages for app mutations, quote refresh and alert delivery. UI changes must merge latest state rather than overwriting newer worker quotes. Use one in-flight refresh promise and deduplicate market+symbol across cards.
- [x] Use chrome.storage.local in the extension and a local browser preview adapter for development. Secrets must never be logged, exported, displayed unmasked or sent to a domain other than the selected provider.
- [x] Recreate missing alarms on worker startup, installation and browser startup. Show notification permission/delivery status and provide a user-triggered test/retry action.

## Task 3: Real provider adapters and rate handling

- [x] Write representative provider fixture tests before adapters. Finnhub fields: `c`, `pc`, `t`, `d`, `dp`. Fugle fields: `lastPrice`, `previousClose`, `lastTrade.time`, `lastUpdated`, `isClose`, `name`; convert microsecond epochs correctly and do not use trial price as a trade.
- [x] Fetch Fugle at `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/{symbol}` with `X-API-KEY`. Fetch Finnhub at `https://finnhub.io/api/v1/quote?symbol={symbol}` with `X-Finnhub-Token`. Verify endpoint schemas against official docs while implementing.
- [x] Distinguish missing credentials, rejected credentials, invalid symbol, no trade, HTTP 429, unavailable provider, timeout and network failure. Preserve last good price and actual quote timestamp on failures.
- [x] Target 30-second polling, with per-provider shared budgets below free-plan limits and provider-wide 429 backoff. Apply the same budget to manual refresh. More symbols use fair rotation; show actual last update rather than claiming every card refreshed each tick.
- [x] Only one worker manages all tabs. Finite positive prices and sufficiently fresh actual quote timestamps are required for notifications. Closing the new tab must not remove background monitoring. Treat time zones and US daylight-saving time correctly; do not infer a live exchange from fetch success alone.

## Task 4: Dashboard and configuration UI

- [x] Build a calm, polished full-screen scenic desktop: a compact brand/date header, visible connection status, add-stock action, two initial empty groups, and individually readable dark cards. Use semantic tokens, clear hierarchy, tabular numerals and consistent SVG icons.
- [x] Add stock editing with market/symbol/name, optional cost/quantity, group, upper/lower alerts. Show validation next to inputs. Cost basis gain toggles between percent and native-currency amount on click and keyboard activation. Keep TWD and USD distinct.
- [x] Implement group create/rename/delete/reorder and stock reorder/move/delete. Provide drag/drop and accessible menu alternatives. Deleting populated groups requires an explicit choice to move cards or remove them, with confirmation.
- [x] Add settings for the two masked keys, provider help links, notification permission/test, built-in backgrounds and custom upload. Keep keys out of rendered attributes when possible. A missing key yields honest empty quote states, never simulated prices.
- [x] Add modal focus containment, Escape/backdrop handling, accessible labels, visible focus, reduced motion, and responsive widths (375/768/1440). Handle multiple tabs via storage updates.
- [x] Use empty-state examples as instructions only; no invented holdings or prices in the real application.

## Task 5: Background assets and documentation

- [x] Use the ten verified records in `docs/research/backgrounds.json`. Download and bundle high-quality optimized originals plus thumbnails. Source URLs and author/license records must remain attached to each image in the picker, current background credit and notices.
- [x] Store uploaded JPEG/PNG/WebP up to 15 MB in IndexedDB after checking decoding and MIME; display clear errors for unsupported/corrupt files. Reuse the selected background after restart, revoke object URLs safely, and provide brightness adjustment/reset.
- [x] Write Chinese README commands and unpacked Chrome installation steps for `dist/`. Explain where to get each key, actual refresh limits, stale data, unverified live connection without keys, native-currency gain formulas and browser sleep/closure behavior.

## Task 6: Verification and two-stage review

- [x] Run `npm run typecheck`, `npm test -- --run`, and `npm run build`; inspect `dist/manifest.json` and all referenced files.
- [x] Add/run meaningful Playwright flows for groups, stock forms, cost display toggle, invalid input, saving settings, selecting each background, valid/invalid upload, reload persistence, and narrow viewport overflow. Use explicit fixture routes only in tests.
- [x] Load the built extension in isolated Chromium for worker/alarm/storage/notification checks; additionally inspect visible UI in the existing Chrome session when available. Record real data verification as pending until actual keys are configured.
- [x] Spec review first, followed by code-quality review using gpt-6-luna/xhigh. Implement fixes and rerun the affected checks; do not substitute a reviewer claim for observed tool results.
- [x] Refresh CodeGraph after code exists and confirm a query finds the new application modules. Deliver the extension directory, concise setup instructions, preview evidence and remaining credential-dependent checks.

## Final verification record

Implementation, two-stage review, and final build/browser checks completed on 2026-10-08. See docs/verification.md for observed results and the remaining notification API coverage and live-credential checks. The unchecked exhaustive alert-test item is a documented test-coverage limitation, not a claim of full coverage.
