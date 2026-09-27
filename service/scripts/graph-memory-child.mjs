import './register-source.mjs';
const { graphFixture } = await import('../packages/ir/test/graph-fixture.ts');
const { GroundingGraphV1Schema, encodeStored } = await import('../packages/ir/src/index.ts');
// Run with --expose-gc (verify-graph-memory.mjs does); the call throws otherwise.
/** @type {() => void} */ (globalThis.gc)();
const baseline = process.memoryUsage().heapUsed;
let peak = baseline;
const sample = () => {
  peak = Math.max(peak, process.memoryUsage().heapUsed);
};
const graph = graphFixture(10_000);
sample();
const parsed = GroundingGraphV1Schema.parse(graph);
sample();
const bytes = encodeStored(parsed);
sample();
const result = {
  nodes: parsed.nodes.length,
  edges: parsed.edges.length,
  heapDelta: peak - baseline,
  serializedBytes: bytes.length,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.heapDelta > 128 * 1024 * 1024 || bytes.length > 32 * 1024 * 1024) process.exitCode = 1;
