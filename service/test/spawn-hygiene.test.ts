// Guard for the console pop-up policy (K21): every child_process spawn in service scripts and tests
// must pass `windowsHide: true`. Programs embedded in string literals are parsed and checked too. A
// call that deliberately omits the option needs a `spawn-hygiene-exempt: <reason>` comment on the
// enclosing statement (for example a workload fixture whose parent already runs hidden).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const serviceRoot = resolve(import.meta.dirname, '..');
const childProcessModules = new Set(['child_process', 'node:child_process']);
const spawners = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']);
const exemption = /spawn-hygiene-exempt:\s*\S/u;
const embeddedPlaceholder = '__sfp_embedded_value__';
const sourceFile = /\.(?:[cm]?js|[cm]?ts)$/u;

interface Finding {
  line: number;
  call: string;
  problem: string;
}

type Verdict = 'hidden' | 'missing' | 'not-true' | 'unverifiable';

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  )
    current = current.expression;
  return current;
};

const isChildProcessModule = (node: ts.Expression): boolean => {
  const value = unwrap(node);
  if (!ts.isCallExpression(value)) return false;
  const loader = value.expression;
  const loads =
    (ts.isIdentifier(loader) && loader.text === 'require') ||
    loader.kind === ts.SyntaxKind.ImportKeyword;
  const specifier = value.arguments[0];
  return (
    loads &&
    specifier !== undefined &&
    ts.isStringLiteralLike(specifier) &&
    childProcessModules.has(specifier.text)
  );
};

const propertyName = (name: ts.PropertyName | ts.BindingName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;

const isExempt = (node: ts.Node, text: string): boolean => {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    const comments = ts.getLeadingCommentRanges(text, current.getFullStart()) ?? [];
    if (comments.some(range => exemption.test(text.slice(range.pos, range.end)))) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
};

const embeddedProgram = (node: ts.Node): string | undefined => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  return (
    node.head.text +
    node.templateSpans.map(span => `${embeddedPlaceholder}${span.literal.text}`).join('')
  );
};

/** Lists child_process calls in `text` whose options do not set `windowsHide: true`. */
const scanSpawnHygiene = (fileName: string, text: string): Finding[] => {
  const scriptKind = /\.[cm]?ts$/u.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const direct = new Map<string, string>();
  const namespaces = new Set<string>();
  const declarations = new Map<string, ts.Expression[]>();

  const collect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      childProcessModules.has(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name) namespaces.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (spawners.has(imported)) direct.set(element.name.text, imported);
        }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (isChildProcessModule(node.initializer)) {
        if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name))
          for (const element of node.name.elements) {
            const imported = propertyName(element.propertyName ?? element.name);
            if (imported && spawners.has(imported) && ts.isIdentifier(element.name))
              direct.set(element.name.text, imported);
          }
      }
      if (ts.isIdentifier(node.name))
        declarations.set(node.name.text, [
          ...(declarations.get(node.name.text) ?? []),
          node.initializer,
        ]);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const isPromisify = (call: ts.CallExpression): boolean =>
    (ts.isIdentifier(call.expression) && call.expression.text === 'promisify') ||
    (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'promisify');

  const spawnerOf = (expression: ts.Expression, seen = new Set<string>()): string | undefined => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const imported = direct.get(node.text);
      if (imported) return imported;
      if (seen.has(node.text)) return undefined;
      seen.add(node.text);
      for (const initializer of declarations.get(node.text) ?? []) {
        const value = unwrap(initializer);
        if (ts.isCallExpression(value) && isPromisify(value) && value.arguments[0]) {
          const promisified = spawnerOf(value.arguments[0], seen);
          if (promisified) return promisified;
        }
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node) && spawners.has(node.name.text)) {
      const target = unwrap(node.expression);
      if (ts.isIdentifier(target) && namespaces.has(target.text)) return node.name.text;
      if (isChildProcessModule(target)) return node.name.text;
    }
    if (ts.isCallExpression(node) && isPromisify(node) && node.arguments[0])
      return spawnerOf(node.arguments[0], seen);
    return undefined;
  };

  const objectLiterals = (
    expression: ts.Expression,
    seen = new Set<string>(),
  ): ts.ObjectLiteralExpression[] | undefined => {
    const node = unwrap(expression);
    if (ts.isObjectLiteralExpression(node)) return [node];
    if (!ts.isIdentifier(node) || seen.has(node.text)) return undefined;
    seen.add(node.text);
    const candidates = declarations.get(node.text) ?? [];
    if (candidates.length === 0) return undefined;
    const resolved = candidates.map(candidate => objectLiterals(candidate, seen));
    return resolved.every(item => item !== undefined) ? resolved.flat() : undefined;
  };

  const verdictOf = (expression: ts.Expression): Verdict => {
    const literals = objectLiterals(expression);
    if (!literals) return 'unverifiable';
    const verdicts = literals.map(literal => {
      let verdict: Verdict = 'missing';
      for (const property of literal.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = objectLiterals(property.expression)
            ? verdictOf(property.expression)
            : null;
          if (spread === 'hidden' || spread === 'not-true') verdict = spread;
        } else if (property.name && propertyName(property.name) === 'windowsHide') {
          verdict =
            ts.isPropertyAssignment(property) &&
            property.initializer.kind === ts.SyntaxKind.TrueKeyword
              ? 'hidden'
              : 'not-true';
        }
      }
      return verdict;
    });
    return verdicts.find(verdict => verdict !== 'hidden') ?? 'hidden';
  };

  const isCallback = (node: ts.Expression): boolean =>
    ts.isArrowFunction(node) || ts.isFunctionExpression(node);

  const optionsArgument = (spawner: string, call: ts.CallExpression): ts.Expression | undefined => {
    const args = [...call.arguments];
    while (args.length > 1 && isCallback(args.at(-1)!)) args.pop();
    if (spawner === 'exec' || spawner === 'execSync') return args[1];
    if (args.length >= 3) return args[2];
    if (args.length === 2 && objectLiterals(args[1]!)) return args[1];
    return undefined;
  };

  const findings: Finding[] = [];
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const spawner = spawnerOf(node.expression);
      if (spawner && !isExempt(node, text)) {
        const options = optionsArgument(spawner, node);
        const verdict = options ? verdictOf(options) : 'missing';
        if (verdict !== 'hidden')
          findings.push({
            line: lineOf(node) + 1,
            call: spawner,
            problem:
              verdict === 'missing'
                ? 'options omit windowsHide: true'
                : verdict === 'not-true'
                  ? 'windowsHide is not the literal true'
                  : 'options are not a statically visible object literal',
          });
      }
    }
    const embedded = embeddedProgram(node);
    if (
      embedded?.includes('child_process') &&
      !childProcessModules.has(embedded) &&
      !isExempt(node, text)
    ) {
      const offset = lineOf(node);
      for (const finding of scanSpawnHygiene(`${fileName}#embedded.js`, embedded))
        findings.push({
          ...finding,
          line: offset + finding.line,
          problem: `embedded program: ${finding.problem}`,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

const codeFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && sourceFile.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(path => !/[\\/](?:node_modules|dist)[\\/]/u.test(relative(serviceRoot, path)));
};

const scannedFiles = async (): Promise<string[]> => {
  const packages = await readdir(join(serviceRoot, 'packages'), { withFileTypes: true });
  const roots = [
    join(serviceRoot, 'scripts'),
    join(serviceRoot, 'test'),
    ...packages
      .filter(entry => entry.isDirectory())
      .map(entry => join(serviceRoot, 'packages', entry.name, 'test')),
  ];
  const files = await Promise.all(
    roots.map(root =>
      codeFiles(root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      }),
    ),
  );
  return files.flat().toSorted();
};

describe('spawn hygiene', () => {
  it('hides every child process window in service scripts and tests', async () => {
    const files = await scannedFiles();
    expect(files.length).toBeGreaterThan(100);
    const violations: string[] = [];
    for (const path of files) {
      const text = await readFile(path, 'utf8');
      if (!text.includes('child_process')) continue;
      for (const finding of scanSpawnHygiene(path, text))
        violations.push(
          `${relative(serviceRoot, path).replaceAll('\\', '/')}:${finding.line} ${finding.call}: ${finding.problem}`,
        );
    }
    expect(violations).toEqual([]);
  });

  it('detects every spawn shape the guard claims to cover', () => {
    // spawn-hygiene-exempt: synthetic guard input; these strings are parsed, never executed.
    const source = [
      "import { spawn, execFile as run } from 'node:child_process';",
      "import * as cp from 'node:child_process';",
      "import { promisify } from 'node:util';",
      "const { spawnSync } = require('node:child_process');",
      'const runAsync = promisify(run);',
      "const hidden = { windowsHide: true, stdio: 'pipe' };",
      "spawn('a', ['b']);",
      "spawn('a', ['b'], { stdio: 'pipe' });",
      "spawn('a', ['b'], { windowsHide: false });",
      "spawn('a', ['b'], makeOptions());",
      "run('a', ['b'], () => {});",
      "runAsync('a', ['b'], { cwd: '.' });",
      "cp.exec('a');",
      "spawnSync('a', ['b'], { ...hidden, windowsHide: false });",
      "require('node:child_process').execSync('a', {});",
      '`require("node:child_process").spawn(${x},[],{})`;',
      "spawn('ok', ['b'], { windowsHide: true });",
      "spawn('ok', ['b'], hidden);",
      "spawnSync('ok', ['b'], { ...hidden, cwd: '.' });",
      "cp.execFile('ok', ['b'], { windowsHide: true }, () => {});",
      "cp.exec('ok', { windowsHide: true }, () => {});",
      '"require(\'node:child_process\').spawnSync(process.execPath,[],{windowsHide:true})";',
      '// spawn-hygiene-exempt: a documented fixture',
      "spawn('exempt', ['b']);",
    ].join('\n');
    expect(scanSpawnHygiene('fixture.ts', source).map(finding => finding.line)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });
});
