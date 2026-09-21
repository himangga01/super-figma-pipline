# Cancellation and observation scroll fixes

This report supersedes only the two reproduced bug findings in the [September 15 checkpoint](2026-09-15-development-checkpoint.md). The other outstanding tasks remain open.

## Changes

- `create_variable` checks the execution cancellation signal immediately before its first synchronous write, after all asynchronous collection, alias, and mode preflight. Cancelled requests neither create nor initialize a variable; existing initialization cleanup remains unchanged.
- Browser consumption observations preserve document and ancestor scroll coordinates in the isolated observer world. Temporary visibility scrolling uses instant behavior, and a `finally` block restores coordinates on success or failure. CSS variable probes use the same protection.
- Restoration is verified immediately and after queued scroll events. An unrestorable viewport fails the observation with `PORTAL_CONSUMPTION_SCROLL_RESTORE_FAILED`. Ancestor snapshots are bounded at 256 elements. Intentional interaction scrolling is unchanged.

## Validation

Before editing, all 1,057 tracked service files in the native validation copy matched the main workspace byte for byte. Validation used `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`, under the same Windows account and filesystem/process privileges; this separate copy is not an OS sandbox. No Docker or Superpowers skills were used.

- Before the fixes, new regressions reproduced creation after alias/mode-recheck cancellation and changed viewport state during browser inspection.
- Five related suites passed: 37 tests covering variable creation, mutation accounting, browser consumption, preview interactions, and preview rendering.
- After test typing/formatting corrections, the two changed suites passed again: 24 tests in 30.36 seconds.
- MCP TypeScript and plugin Vue TypeScript checks passed.
- Lint passed for all four changed source/test files.
- Real headless Firefox tests cover nested horizontal/vertical scroll, nonzero original positions, CSS smooth scrolling, successful property reads, failed image inspection, identical before/after screenshots, and page scroll handlers that prevent restoration.

The four verified files were copied back to the main workspace and compared byte for byte. These targeted checks do not constitute the pending full release or live Figma acceptance. Scroll restoration does not roll back arbitrary application-side effects triggered by scroll events.
