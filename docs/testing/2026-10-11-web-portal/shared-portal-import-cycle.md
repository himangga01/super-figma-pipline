# Portal shared-schema import cycle repair

Date: October 11, 2026, 21:31 KST. Scope: four files in managed `4d3e/service`, on Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` plus the coordinator's source integration. This bounded repair follows the [repository instructions](../../../AGENTS.md) and supports the [web portal integration](README.md). It does not modify schema semantics or the concurrently authored CLI feature adapter.

The coordinator's new CLI feature test failed before tests ran because `portal.ts` imported `portal-core-lifecycle.ts`, which imported `portal-recipes.ts`, which imported `portal.ts`. Importing the lifecycle entry first evaluated `PortalCoreDeclarationBatchSchema.default([])` in `portal.ts` before that binding existed. Existing transformed tests often loaded another entry first and did not reveal the runtime cycle.

The new regression starts four clean Node subprocesses, each importing recipes, lifecycle, portal or the public index first. It uses Node's native TypeScript transformation and a resolver limited to this package's `.js` to `.ts` source specifiers. No Vitest import cache is shared with the subprocess. The first run reproduced the exact failure at former `portal.ts:853`: **one failed and three passed**. Evidence remains in managed `.cache/portal-import-order-red.json`.

`PortalLayerSchema`, its `PortalLayer` type and `PortalPathSchema` now live in a leaf module, `portal-base.ts`, which imports only Zod. Both portal and recipes import the leaf. Portal reexports the original public names, so all existing callers retain the same schema object identity and validation behavior. Layer values, portable path checks, reserved-name rejection and all size limits are unchanged. The lifecycle-to-recipes dependency remains valid because recipes no longer reenters portal initialization.

Final checks at 21:27:24 KST: **21/21 passed** across the import-order, portal, recipe and core-recipe-page suites. Shared TypeScript, scoped lint and formatting passed. An initial test-only TypeScript check lacked Node declarations because the shared package is browser-compatible; the subprocess test now explicitly references the existing Node type declarations without adding dependencies. The tests verify invalid paths/layers still fail, public schema identities match, and empty submit requests remain invalid. Managed `.cache/portal-import-order-green.json` preserves the first green execution; a subsequent final run passed after the test-only declaration adjustment.

| Path relative to `service/` | SHA-256 |
| --- | --- |
| `packages/shared/src/portal-base.ts` | `c58941fa7cb7c68abac05003aeae00e5188ed1a76bf1c42b9942c67bc0fe5d2d` |
| `packages/shared/src/portal.ts` | `0706a4f77a9116efef1ff434e13292b128138666d4b4045da9dea295f042b2d4` |
| `packages/shared/src/portal-recipes.ts` | `7acfc69e8555e974045bd206b2c96b4d789be22a134632cf3f1d251989b1bd64` |
| `packages/shared/test/portal-import-order.test.ts` | `e884d622e99fec85725ed54de10d9177de036ebd0ceaa757629af61f974f82ef` |

The coordinator must copy all four paths together and rerun the previously blocked CLI adapter tests on the actual integration source. This author did not run the whole repository check, start another daemon, alter dependencies or use Chrome for this repair. The separate managed checkout shares the same Windows owner and is not a security sandbox.
