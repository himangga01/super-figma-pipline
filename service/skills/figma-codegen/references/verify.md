# Verify the native portal

Render generated code with the actual project toolchain. A successful scaffold or build alone is not verified UX.

## Use the portal validation flow

1. Create an owner-reviewed native profile for the exact candidate and relevant script/configuration closure. Use a separate work copy. Do not use Docker or automatically substitute another container/VM.
2. Install dependencies with lifecycle scripts disabled unless the reviewed profile explicitly enables them. Start the actual application and its necessary native test services. Never provide production credentials.
3. Run `portal_validate`. Use headless Firefox for previews. Do not launch Chrome, create a Chrome tab/profile, or repurpose the user's Figma tab for application previews.
4. Compare against an exported PNG for the same Figma node and source scope, with matching viewport, DPR, fonts, assets, locale and state. An editor screenshot is not the design oracle. The service's native preview helper records actual/diff images and fails on visual mismatches.
5. Exercise routing, forms, keyboard/focus behavior, error states and responsive layouts. Add the project's full accessibility checks. Basic DOM labeling checks alone are not a complete accessibility review.
6. For C2/C3, verify the unmocked frontend-to-API-to-data journey, required authorization, migrations, jobs and integrations. Frontend mocks plus independent backend tests do not prove the portal is wired correctly. Only C4 is frontend-only.
7. Read the returned failed checks/logs, repair the candidate through its lease, and validate again within the original budget. Missing or skipped required checks remain incomplete.
8. Apply only a fully accepted candidate, then validate the actual applied source. For live-bound designs, require the final design recheck to match. Preserve conflicts and uncertain effects for explicit reconciliation.

Use the [native portal guide](../../../docs/portal-native.md) for profile registration, the Firefox helper and recovery commands. Raw native execution runs under the local owner account; work-copy and command controls do not provide an OS security sandbox.
