// Read-only review diagnostics. Uses fake Figma objects and temporary fixture files.
// Run after building service/: node --experimental-transform-types docs/reviews/2026-09-05-rereview-reproduce.mjs
// This prints observed defects; exit 0 means the diagnostics ran, not that the product passed.
import { existsSync } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const serviceUrl = new URL("../../service/", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        context.parentURL?.startsWith(serviceUrl.href)
      ) {
        const fallback = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (existsSync(fallback)) return nextResolve(fallback.href, context);
      }
      throw error;
    }
  },
});

const { createFigmaReadProgram, readScripterSnapshot, parseFigmaTarget } = await import(
  new URL("packages/cli/dist/library.mjs", serviceUrl)
);
const { readDesktopDesign } = await import(
  new URL("packages/cli/src/desktop-reader.ts", serviceUrl)
);
const leaves = Array.from({ length: 3 }, (_, index) => ({
  id: `1:${index + 1}`,
  type: "FRAME",
  name: `Root${index + 1}`,
  children: [],
}));
const fakeFigma = {
  root: { name: "ReviewFixture" },
  currentPage: { id: "0:1", name: "Page", selection: [], children: leaves },
  getNodeByIdAsync: async (id) => leaves.find((node) => node.id === id),
  variables: {
    getLocalVariablesAsync: async () =>
      Array.from({ length: 257 }, (_, index) => ({
        id: `v${index}`,
        name: `Token${index}`,
        resolvedType: "FLOAT",
        valuesByMode: { default: index },
      })),
  },
};
const vars = JSON.parse(
  await runInNewContext(createFigmaReadProgram({ depth: 5, maxNodes: 10 }), { figma: fakeFigma }),
);
const target = parseFigmaTarget("https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS");
const frame = {
  url: () => "https://scripter.rsms.me/",
  evaluate: (_callback, { program }) => runInNewContext(program, { figma: fakeFigma }),
};
const page = { url: () => target.url, frames: () => [frame] };
const limited = await readScripterSnapshot(page, target, {
  depth: 5,
  maxNodes: 1,
  includeTokens: false,
});
const properties = Object.fromEntries(
  Array.from({ length: 129 }, (_, index) => [`property${index}`, { value: index }]),
);
const masked = {
  ...leaves[0],
  isMask: true,
  maskType: "ALPHA",
  layoutMode: "GRID",
  gridRowCount: 2,
  gridColumnCount: 3,
  componentProperties: properties,
};
const fields = JSON.parse(
  await runInNewContext(createFigmaReadProgram({ depth: 5 }), {
    figma: {
      ...fakeFigma,
      currentPage: { ...fakeFigma.currentPage, children: [masked] },
      variables: undefined,
    },
  }),
);

const { RepoReader } = await import(new URL("packages/mcp/src/fs/repo-walk.ts", serviceUrl));
const root = await mkdtemp(join(tmpdir(), "sfp-rereview-gitfile-"));
let plain, worktree;
try {
  await writeFile(join(root, "Button.tsx"), "export const Button = () => <button>OK</button>;");
  plain = await new RepoReader({ rootDir: root }).walk({ extensions: [".tsx"] });
  await writeFile(join(root, ".git"), "gitdir: C:/fixtures/main/.git/worktrees/target\n");
  try {
    worktree = {
      accepted: true,
      result: await new RepoReader({ rootDir: root }).walk({ extensions: [".tsx"] }),
    };
  } catch (error) {
    worktree = { accepted: false, code: error.code, message: error.message };
  }
} finally {
  // Only the two known fixture files and their empty temporary directory are removed.
  for (const name of [".git", "Button.tsx"]) {
    await unlink(join(root, name)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await rmdir(root);
}

const { createBatchHandler } = await import(
  new URL("packages/plugin/src/handlers/batch.ts", serviceUrl)
);
const { createMoveNodesHandler } = await import(
  new URL("packages/plugin/src/handlers/move-nodes.ts", serviceUrl)
);
let failSetter = true,
  nodeY = 20;
const node = {
  id: "1:1",
  x: 10,
  get y() {
    return nodeY;
  },
  set y(value) {
    if (failSetter) {
      failSetter = false;
      throw new Error("HOST_SETTER_FAILURE");
    }
    nodeY = value;
  },
};
const host = { getNodeByIdAsync: async () => node };
let batchError;
try {
  await createBatchHandler(host, { move_nodes: createMoveNodesHandler(host) })({
    ops: [{ tool: "move_nodes", params: { nodeIds: ["1:1"], dx: 89, dy: 80 } }],
  });
} catch (error) {
  batchError = error.message;
}

const desktop = await readDesktopDesign(
  {
    readTool: async (name) =>
      name === "get_metadata"
        ? { currentPage: { id: "0:1", name: "A" } }
        : name === "get_document"
          ? { pageId: "0:2", pageName: "B", children: [] }
          : {},
  },
  "fixture-session",
  null,
);

console.log(
  JSON.stringify(
    {
      tokenOverflow: { input: 257, output: vars.tokens.length, truncated: vars.truncated },
      rootOverflow: {
        input: leaves.length,
        output: limited.nodes.length,
        truncated: limited.truncated,
        pendingRootIds: limited.pendingRootIds,
      },
      fieldCoverage: {
        inputFields: ["isMask", "maskType", "gridRowCount", "gridColumnCount"],
        preserved: ["isMask", "maskType", "gridRowCount", "gridColumnCount"].filter(
          (key) => key in fields.nodes[0],
        ),
        componentPropertiesIn: 129,
        componentPropertiesOut: Object.keys(fields.nodes[0].componentProperties).length,
        truncated: fields.truncated,
      },
      gitfile: { plain, worktree },
      batchFailure: {
        before: { x: 10, y: 20 },
        after: { x: node.x, y: node.y },
        error: batchError,
      },
      desktopPageMixing: {
        metadataPage: desktop.metadata.currentPage.id,
        documentPage: desktop.document.pageId,
      },
    },
    null,
    2,
  ),
);
