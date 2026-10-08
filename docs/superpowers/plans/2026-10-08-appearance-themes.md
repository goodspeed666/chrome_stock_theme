# Appearance Themes Implementation Plan

**Goal:** Deliver three selectable, persistent visual themes using the approved design.

**Architecture:** Add a validated theme preference to the existing settings model and adapter. Apply a root data attribute and shared semantic CSS tokens; use an accessible preview selector in SettingsDrawer. Keep backgrounds independent and preserve existing operations.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright, Chrome MV3.

- [x] Add theme IDs/catalog (forest, midnight, sand), default and normalization in domain/types.ts and data/storage.ts. Validate missing/unknown values using existing storage tests.
- [x] Wire SettingsDrawer preview choices through update-settings and apply the root attribute in App.tsx, including portal dialogs. Preserve settings errors and keyboard access.
- [x] Audit styles.css colors and introduce semantic surface/text/border/accent tokens for all three appearances, preserving forest and market colors. Cover cards, menus, settings, form controls, dialog footers, badges and focus states.
- [x] Extend accountSync.ts ordinary preferences compatibly if needed; accept old snapshots and validate unknown themes. Cover round trips and old snapshot behavior.
- [x] Build and run unit tests. Run relevant browser tests and actual desktop/mobile previews of all themes, including reload persistence and dialogs. Inspect screenshots, stop preview server, and report results without committing.

Validation: 104 unit tests and 15 browser tests passed. Production build passed; final CSS refinements rebuilt and visually inspected. Desktop/mobile previews are in `/tmp/stock-themes/`. No commit or push performed.

## Extension to six themes

- [x] Extend theme IDs and the selector with graphite, dusk, sky.
- [x] Reuse the theme styling structure for all surfaces; preserve existing themes. Verify light/dark state and limit-up variants.
- [x] Cover storage/sync for all six IDs, browser switching and persistence. Build, run relevant tests and inspect desktop/mobile previews, including forms and settings. No commit/push.

Six-theme validation: production build and 105 unit tests passed; focused extension E2E covers six choices, keyboard switching, reload/reopen persistence and layout. Desktop/mobile home, settings and form screenshots are in `/tmp/stock-themes-six/`. Sky contrast issues found in visual review were corrected.
