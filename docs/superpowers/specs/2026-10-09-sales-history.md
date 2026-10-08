# Sold positions and local history

User approved this design on 2026-10-09.

A stock menu action 已賣出 opens a form with required positive per-share sale price and sale date (today by default, Taiwan calendar date). It sells the entire tracked position; no partial quantities. Saving atomically removes the active stock and appends a local historical snapshot of identity, cost, shares, alerts and former group. No broker order is placed. History is excluded from Chrome sync; active portfolio mutations continue syncing normally.

A 歷史記錄 entry beside the portfolio title opens history. Default filter is the last 30 calendar days including today; users can select a month intersecting the retained period. Show original name/symbol/market, cost, shares, sale price/date and realized gain when cost exists; without shares show per-share gain. Calculations retain full precision, exclude fees/dividends and never mix currencies in a total. Use established market price and money display rules.

Allow editing sale price/date (valid, nonfuture, within the retained year) and restoring. Restore atomically removes the historical sale and returns a clean active stock with original cost/shares/alerts, no stale quote or pending notifications. Preserve original group when present; require a destination group when absent. Prevent duplicate operations or stock-ID collisions without losing history.

Keep at most a rolling calendar year by sale date in Asia/Taipei; older records are pruned at load/operations and when the open page crosses the date boundary. Expired records cannot be restored. Handle leap years deterministically. No initial bulk deletion except history retention. Existing users migrate to an empty local history. Six themes, keyboard access, responsive layouts and pending/error states are supported. No commit/push requested.
