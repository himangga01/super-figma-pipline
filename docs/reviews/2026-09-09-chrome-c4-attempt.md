# Existing Chrome connection reuse and C4 validation attempt

Date: 2026-09-09.

## Requested validation

Restore access to the existing Chrome session and implement a new, reference-free frontend from Figma file `4IBhv1d8hEclifZQrOYxHS`, node `0:1`. The requested strategy is `blank-frontend`, with React/Vite and an independent output root at `C:/Users/c/Projects/SuperFigmaPortals/figma-ecommerce-c4-20260909`.

No Chrome window or tab was launched or navigated. No Docker or Superpowers skill was used. The official Figma MCP and the built-in browser were not used to collect the design.

## Repeated permission prompts

The diagnostic commands opened separate CDP connections. The original daemon capture implementation also opened and closed a transport for each capture. This caused repeated Chrome permission requests.

`ExistingChromeConnection` now retains one approved transport for the daemon lifetime. It shares an in-flight connection between consumers, preserves the connection when the requested tab is absent, and releases the transport only at shutdown. Completing a capture releases its logical session without disconnecting Chrome. A real browser disconnection or service restart can still require a new initial permission. Standalone one-shot inspection commands are separate processes and do not share the daemon's connection.

Repeated ad hoc connection attempts were stopped after the user reported the prompts. One attempt through the updated daemon returned `CHROME_CONNECTION_REQUIRED`; no automatic retry loop was started afterward.

## Additional defects found through the real CLI path

1. Polling an accepted operation before journal creation returned HTTP 500 for `OPERATION_NOT_FOUND`. The CLI treated it as fatal and abandoned the invocation. The server now returns HTTP 404, matching the client's bounded pending-operation behavior.
2. Workspace-bound tool results forwarded a private evidence projection containing `contextHash` into the strict public no-artifact receipt schema. Runtime work could finish while terminal persistence failed. The executor now writes only the public `kind` and `reasonCode` fields. A regression test uses the real journal, egress store and receipt store.

The corrected real CLI invocation reached `succeeded` and returned a C4 plan. Its design remains incomplete because the browser connection was unavailable. Operation success means planning succeeded; it does not mean the portal or live design was validated.

## Verification

- Browser session, capture flow and control router tests: 91 passed.
- Operation executor tests: 29 passed.
- Workspace package type checking passed.
- MCP and CLI builds passed.
- The real C4 `portal_plan` completed through the authenticated CLI, approval, execution and durable-result path.
- Native lint/format tools could not load their Windows bindings because Application Control blocked them. No security policy was disabled. The previous provenance receipt is not current evidence for these source edits; metadata refresh and final formatting verification remain pending.

The Windows window-inspection helper also reported that its native pipe was unavailable. It did not inspect or alter Chrome's UI.

## Current result

Plan ID: `sfp_portal1_5128eeb224d0aeaedd007a6e08380c28`.

The result retains `CHROME_CONNECTION_REQUIRED`, `DESIGN_CAPTURE_REQUIRED` and `LIVE_DESIGN_VERIFICATION_REQUIRED`. The design hash is null, and both `complete` and `liveVerified` are false. The CLI evidence is saved in `validation/c4-20260909/plan-output.jsonl`.

No candidate application was generated or marked complete from historical captures. The actual Figma-based C4 implementation, screenshot comparison and interaction validation remain pending access to the existing authorized Chrome tab. The supplied Figma URL is already retained and does not need to be provided again.
