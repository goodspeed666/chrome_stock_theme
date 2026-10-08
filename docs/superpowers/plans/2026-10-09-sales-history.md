# Sales History Implementation Plan

**Goal:** Add atomic whole-position sale, local history filtering/editing/restoration and one-year retention.

**Architecture:** Domain history helpers validate calendar dates and snapshot positions. Extend AppState and shared state operations so local and extension workers use the same atomic transitions. Chrome sync retains local history through imports without exporting it. Dedicated sale and history dialogs use existing theme tokens.

**Tech Stack:** React, TypeScript, Chrome MV3 storage, Vitest, Playwright.

- [x] Add history types, date/retention helpers and atomic sell/edit/restore operations; normalize legacy data and retain local-only history on sync merge.
- [x] Add targeted unit tests for snapshots, validation, 30-day/month filters, calendar-year/leap boundaries, expiry, restore with missing group and duplicate actions.
- [x] Integrate 已賣出 in StockCard, sale form and history entry/dialog in App. Reuse existing mutation error flow, themes and accessible dialogs; require explicit destination if original group was deleted.
- [x] Browser-test extension save/reload/edit/filter/restore and responsive theme states. Verify closed/removed stocks stop quotes and notifications, no stale notification data after restore, and history is absent from sync payloads.
- [x] Build and run appropriate complete unit/E2E checks, inspect screenshots, preserve pending menu-stacking fix, and stop preview servers. No commit/push.

Validation: 117 unit tests and 20 E2E tests passed; production build passed. Desktop/mobile light/dark screenshots inspected. Tracked test artifacts restored; preview server stopped.

Compatibility follow-up: mixed UI/worker versions now require a read-only sales-history capability handshake before new mutations. Unknown or malformed mutations fail before any write; no-op prune skips storage and sync writes. Regression tests include the legacy-worker reset path and direct worker storage-write observation. Validation: 119 unit tests and 22 E2E tests passed; build passed.
