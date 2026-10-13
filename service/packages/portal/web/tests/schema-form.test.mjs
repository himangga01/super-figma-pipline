import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { test } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { createTextTool } from '../../../mcp/src/tools/create-text.js';
import { getNodesInfoTool } from '../../../mcp/src/tools/get-nodes-info.js';
import { importSvgTool } from '../../../mcp/src/tools/import-svg.js';
import { setTextTool } from '../../../mcp/src/tools/set-text.js';
import {
  coerceSchemaScalar,
  checkSchemaValue,
  schemaAlternatives,
  readBoundedSchemaJson,
  MAX_SCHEMA_JSON_BYTES,
} from '../schema-form.js';
import { catalogEntries, functionRequest } from '../service-functions.js';

test('common scalar inputs preserve false, zero and explicit null and reject empty or nonfinite numbers', () => {
  assert.equal(coerceSchemaScalar({ type: 'boolean' }, false), false);
  assert.equal(coerceSchemaScalar({ type: 'integer' }, '0'), 0);
  assert.equal(coerceSchemaScalar({ type: 'null' }, ''), null);
  for (const value of ['', ' ', 'Infinity', 'NaN', '0.5'])
    assert.throws(() => coerceSchemaScalar({ type: 'integer' }, value));
  assert.throws(() => coerceSchemaScalar({ type: 'boolean' }, 'false'));
});

test('nested object and array fields require real IDs and preserve omitted optional fields', () => {
  const schema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: {
          type: 'object',
          required: ['id', 'enabled'],
          additionalProperties: false,
          properties: {
            id: { type: 'string', pattern: '^node-[0-9]+$' },
            enabled: { type: 'boolean' },
            count: { type: 'integer', minimum: 0 },
          },
        },
      },
      note: { type: 'string' },
    },
  };
  const value = { items: [{ id: 'node-2', enabled: false, count: 0 }] };
  assert.equal(checkSchemaValue(schema, value), value);
  assert.equal(Object.hasOwn(value, 'note'), false);
  assert.throws(() => checkSchemaValue(schema, { items: [] }), /개수/);
  assert.throws(
    () => checkSchemaValue(schema, { items: [{ id: 'made-up', enabled: false }] }),
    /형식/,
  );
  assert.throws(() => checkSchemaValue(schema, { items: [{ id: 'node-1' }] }), /필수/);
  assert.throws(() => checkSchemaValue(schema, { ...value, unknown: 'private' }), /등록되지/);
});

test('nullable, scalar alternatives and tagged object alternatives remain distinct', () => {
  const nullable = { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] };
  assert.equal(checkSchemaValue(nullable, null), null);
  assert.equal(checkSchemaValue(nullable, 'value'), 'value');
  assert.throws(() => checkSchemaValue(nullable, ''), /유형/);
  const tagged = {
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'value'],
        properties: { kind: { const: 'number' }, value: { type: 'number' } },
        additionalProperties: false,
      },
      {
        type: 'object',
        required: ['kind', 'value'],
        properties: { kind: { const: 'text' }, value: { type: 'string' } },
        additionalProperties: false,
      },
    ],
  };
  assert.deepEqual(checkSchemaValue(tagged, { kind: 'number', value: 0 }), {
    kind: 'number',
    value: 0,
  });
  assert.throws(() => checkSchemaValue(tagged, { kind: 'number', value: '0' }), /유형/);
  assert.equal(schemaAlternatives({ anyOf: [nullable, { type: 'integer' }] }).length, 3);
});

test('named object values are checked without accepting prototype aliases or arbitrary keys', () => {
  const schema = {
    type: 'object',
    propertyNames: { type: 'string', enum: ['on', 'off'] },
    additionalProperties: { type: 'boolean' },
  };
  assert.deepEqual(checkSchemaValue(schema, { on: true, off: false }), { on: true, off: false });
  assert.throws(() => checkSchemaValue(schema, { unknown: true }), /선택지/);
  assert.throws(() => checkSchemaValue(schema, JSON.parse('{"__proto__":true}')), /허용되지/);
  assert.throws(() => checkSchemaValue(schema, { on: 'true' }), /boolean/);
});

test('enum, exclusive bounds, unique items and ambiguous oneOf are not coerced into success', () => {
  assert.throws(() => checkSchemaValue({ enum: [0, 1] }, '0'), /선택지/);
  assert.throws(() => checkSchemaValue({ type: 'number', exclusiveMinimum: 0 }, 0), /범위/);
  assert.throws(() => checkSchemaValue({ type: 'array', uniqueItems: true }, ['a', 'a']), /중복/);
  assert.throws(
    () => checkSchemaValue({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1),
    /유형/,
  );
});

test('catalog retains all registered transports and aliases while rejecting duplicate identities', () => {
  const descriptor = {
    name: 'get_node',
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    prerequisites: ['A paired source is required.'],
  };
  const entries = catalogEntries({
    tools: [descriptor],
    features: [{ ...descriptor, aliasOf: { type: 'tool', name: 'get_node' } }],
  });
  assert.deepEqual(
    entries.map(entry => entry.id),
    ['tool:get_node', 'feature:get_node'],
  );
  assert.deepEqual(entries[1].aliasOf, { type: 'tool', name: 'get_node' });
  assert.throws(() => catalogEntries({ tools: [descriptor, descriptor], features: [] }), /중복/);
  assert.throws(
    () => catalogEntries({ tools: [{ ...descriptor, inputSchema: undefined }], features: [] }),
    /누락/,
  );
});

test('function requests use explicitly selected actual targets and never invent session or identity hashes', () => {
  const entry = { type: 'tool', name: 'get_node' };
  assert.deepEqual(functionRequest(entry, { nodeId: '1:2' }, '', 'none'), {
    type: 'tool',
    name: 'get_node',
    args: { nodeId: '1:2' },
    workspaceId: null,
    targetSelector: { kind: 'none' },
  });
  assert.throws(() => functionRequest(entry, {}, '', 'session', ''), /실제/);
  assert.throws(() => functionRequest(entry, {}, '', 'stable-file', 'fake'), /실제/);
  assert.deepEqual(
    functionRequest(entry, {}, '', 'stable-file', 'sha256:' + 'a'.repeat(64)).targetSelector,
    { kind: 'stable-file', fileIdentityHash: 'sha256:' + 'a'.repeat(64) },
  );
  assert.throws(() => functionRequest(entry, {}, '', 'invented'), /선택/);
});

test('JSON and full serialized requests enforce UTF-8 server limits without truncating input', () => {
  assert.equal(readBoundedSchemaJson(JSON.stringify('x'.repeat(300000))).length, 300000);
  assert.throws(
    () => readBoundedSchemaJson(JSON.stringify('가'.repeat(MAX_SCHEMA_JSON_BYTES / 3))),
    /12 MiB/,
  );
  assert.throws(
    () =>
      functionRequest(
        { type: 'tool', name: 'set_text' },
        { characters: 'x'.repeat(MAX_SCHEMA_JSON_BYTES) },
        '',
        'none',
      ),
    /12 MiB/,
  );
});

test('ordinary nested forms serialize real Chrome controls, nullable alternatives and an empty dictionary', async context => {
  const require = createRequire(new URL('../../../cli/package.json', import.meta.url));
  const { chromium } = require('playwright');
  const candidates = [
    process.env.SFP_CHROME_EXECUTABLE,
    join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  const existence = await Promise.allSettled(candidates.map(path => access(path)));
  const executablePath = candidates[existence.findIndex(result => result.status === 'fulfilled')];
  requireChrome(context, executablePath);
  assert.ok(executablePath, 'Installed Google Chrome is required, without an alternate runtime.');
  const source = await readFile(new URL('../schema-form.js', import.meta.url), 'utf8');
  const catalogSource = await readFile(new URL('../service-functions.js', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    response.setHeader(
      'Content-Type',
      request.url?.endsWith('.js') ? 'text/javascript' : 'text/html',
    );
    response.end(
      request.url === '/service-functions.js'
        ? catalogSource
        : request.url === '/schema-form.js'
          ? source
          : '<!doctype html><div id="fields"></div><script type="module">import {mountSchemaForm} from "/schema-form.js";import {mountServiceFunctions} from "/service-functions.js";globalThis.mountSchemaForm=mountSchemaForm;globalThis.mountServiceFunctions=mountServiceFunctions;</script>',
    );
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof globalThis.mountSchemaForm === 'function');
    await page.evaluate(() => {
      globalThis.form = globalThis.mountSchemaForm(
        document.getElementById('fields'),
        {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'count', 'values', 'dictionary', 'nullable'],
          properties: {
            enabled: { type: 'boolean' },
            count: { type: 'integer' },
            optional: { type: 'string', default: 'not-automatically-included' },
            values: { type: 'array', items: { type: 'string', minLength: 1 } },
            dictionary: { type: 'object', additionalProperties: { type: 'number' } },
            nullable: { default: null, anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        {
          value: { enabled: false, count: 0, values: ['existing'], dictionary: {} },
        },
      );
    });
    assert.deepEqual(await page.evaluate(() => globalThis.form.read()), {
      enabled: false,
      count: 0,
      values: ['existing'],
      dictionary: {},
      nullable: null,
    });
    await page.locator('[data-schema-field="count"] input').fill('3');
    await page.locator('[data-schema-field="enabled"] input').check();
    await page.locator('[data-schema-field="optional"] input[type=checkbox]').check();
    assert.deepEqual(await page.evaluate(() => globalThis.form.read()), {
      enabled: true,
      count: 3,
      optional: 'not-automatically-included',
      values: ['existing'],
      dictionary: {},
      nullable: null,
    });
    await page
      .locator('[data-schema-field="dictionary"]')
      .getByRole('button', { name: '이름 있는 항목 추가' })
      .click();
    await page.getByLabel('입력.dictionary 항목 이름', { exact: true }).fill('amount');
    await page.getByLabel('입력.dictionary.추가 항목', { exact: true }).fill('0');
    assert.deepEqual((await page.evaluate(() => globalThis.form.read())).dictionary, { amount: 0 });
    const multilineCases = [
      {
        name: 'set_text',
        schema: setTextTool.inputSchema.toJSONSchema(),
        value: { nodeId: '1:2', characters: 'First\nSecond' },
      },
      {
        name: 'create_text',
        schema: createTextTool.inputSchema.toJSONSchema(),
        value: { characters: 'First\nSecond' },
      },
      {
        name: 'import_svg',
        schema: importSvgTool.inputSchema.toJSONSchema(),
        value: { svg: '<svg\nxmlns="http://www.w3.org/2000/svg"/>' },
      },
      { name: 'bounded', schema: { type: 'string', maxLength: 32 }, value: 'First\nSecond' },
    ];
    const serialized = await page.evaluate(
      cases =>
        cases.map(item => {
          const form = globalThis.mountSchemaForm(document.getElementById('fields'), item.schema, {
            value: item.value,
          });
          return { name: item.name, value: form.read() };
        }),
      multilineCases,
    );
    assert.deepEqual(
      serialized,
      multilineCases.map(({ name, value }) => ({ name, value })),
    );
    await page.evaluate(schema => {
      globalThis.form = globalThis.mountSchemaForm(document.getElementById('fields'), schema, {
        value: { nodeId: '1:2', characters: '' },
      });
    }, setTextTool.inputSchema.toJSONSchema());
    await page.getByLabel('입력.characters', { exact: true }).fill('Typed\nparagraph');
    assert.equal(
      (await page.evaluate(() => globalThis.form.read())).characters,
      'Typed\nparagraph',
    );
    await page.getByLabel('입력.characters', { exact: true }).fill('Windows\r\nparagraph');
    assert.equal(
      (await page.evaluate(() => globalThis.form.read())).characters,
      'Windows\nparagraph',
      'Ordinary textarea edits explicitly use browser LF normalization.',
    );
    await page.evaluate(() => {
      globalThis.form = globalThis.mountSchemaForm(
        document.getElementById('fields'),
        { type: 'string', maxLength: 64 },
        { value: 'one\r\ntwo\rthree\nfour' },
      );
    });
    assert.equal(
      await page.evaluate(() => globalThis.form.read()),
      'one\r\ntwo\rthree\nfour',
      'An unedited seed retains its exact characters.',
    );
    await page.getByLabel('입력', { exact: true }).fill('changed');
    await page.getByLabel('입력', { exact: true }).fill('one\ntwo\nthree\nfour');
    assert.equal(
      await page.evaluate(() => globalThis.form.read()),
      'one\ntwo\nthree\nfour',
      'Editing and reverting the visible text does not restore hidden original CR characters.',
    );
    await page.locator('details').getByText('고급: 정확한 문자열 원문', { exact: true }).click();
    await page.getByLabel('입력 문자열 원문 JSON 사용', { exact: true }).check();
    await page
      .getByLabel('입력 문자열 원문 JSON', { exact: true })
      .fill(JSON.stringify('one\r\ntwo\rthree\nfour\tend'));
    assert.equal(await page.evaluate(() => globalThis.form.read()), 'one\r\ntwo\rthree\nfour\tend');
    await page.getByLabel('입력 문자열 원문 JSON', { exact: true }).fill('{}');
    assert.match(
      await page.evaluate(() => {
        try {
          globalThis.form.read();
          return '';
        } catch (error) {
          return error.message;
        }
      }),
      /문자열/,
    );
    await page
      .getByLabel('입력 문자열 원문 JSON 사용', { exact: true })
      .evaluate(element => element.click());
    assert.equal(
      await page.getByLabel('입력 문자열 원문 JSON 사용', { exact: true }).isChecked(),
      true,
      'Invalid exact input cannot silently fall back to ordinary input.',
    );
    await page
      .getByLabel('입력 문자열 원문 JSON', { exact: true })
      .fill(JSON.stringify('valid\r\nsource'));
    await page.getByLabel('입력 문자열 원문 JSON 사용', { exact: true }).uncheck();
    assert.equal(await page.evaluate(() => globalThis.form.read()), 'valid\r\nsource');
    await page.evaluate(() => {
      globalThis.form = globalThis.mountSchemaForm(document.getElementById('fields'), {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      });
    });
    await page.getByText('고급: 전체 입력 JSON', { exact: true }).click();
    await page.getByLabel('입력 전체 JSON 사용', { exact: true }).check();
    await page.getByLabel('입력 전체 JSON', { exact: true }).fill('{"id":"actual-selected-id"}');
    assert.deepEqual(await page.evaluate(() => globalThis.form.read()), {
      id: 'actual-selected-id',
    });
    const bulkValue = { nodeIds: Array.from({ length: 1001 }, (_, index) => `1:${index}`) };
    assert.equal(getNodesInfoTool.inputSchema.safeParse(bulkValue).success, true);
    await page.evaluate(
      ({ schema, value }) => {
        globalThis.form = globalThis.mountSchemaForm(document.getElementById('fields'), schema, {
          value,
        });
      },
      { schema: getNodesInfoTool.inputSchema.toJSONSchema(), value: bulkValue },
    );
    assert.equal(await page.getByLabel('입력 전체 JSON 사용', { exact: true }).isChecked(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.form.read()), bulkValue);
    assert.equal(
      await page.locator('#fields textarea').count(),
      1,
      'Bulk values do not require more than1000 ordinary DOM rows.',
    );
    await page
      .getByLabel('입력 전체 JSON', { exact: true })
      .fill(JSON.stringify({ nodeIds: ['1:1', 2] }));
    assert.match(
      await page.evaluate(() => {
        try {
          globalThis.form.read();
          return '';
        } catch (error) {
          return error.message;
        }
      }),
      /string/,
    );
    await page.evaluate(() => {
      globalThis.form = globalThis.mountSchemaForm(document.getElementById('fields'), {
        type: 'object',
        properties: { payload: {} },
        required: ['payload'],
      });
    });
    const largeComposite = { content: 'x'.repeat(300000), lines: ['a', 'b'] };
    await page.getByText('고급: 복합 입력 JSON', { exact: true }).click();
    await page
      .getByLabel('입력.payload 고급 JSON', { exact: true })
      .fill(JSON.stringify(largeComposite));
    assert.deepEqual((await page.evaluate(() => globalThis.form.read())).payload, largeComposite);
    assert.equal(
      await page.getByLabel('입력.payload 고급 JSON', { exact: true }).getAttribute('maxlength'),
      null,
    );
    await page.evaluate(async () => {
      const descriptor = {
        name: 'get_node',
        kind: 'read',
        group: 'Figma 읽기',
        description: 'Fixture registered read.',
        inputSchema: {
          type: 'object',
          properties: { nodeId: { type: 'string', pattern: '^\\d+:\\d+$' } },
          required: ['nodeId'],
          additionalProperties: false,
        },
        prerequisites: ['A real source connection is required.'],
        confirmationRequired: false,
      };
      globalThis.calls = [];
      globalThis.mountServiceFunctions(document.getElementById('fields'), {
        workspaces: [
          {
            workspaceId: '00000000-0000-4000-8000-000000000099',
            realPath: 'C:/moved-fixture',
            availability: 'identity-mismatch',
          },
        ],
        api: {
          serviceCatalog: async () => ({
            tools: [descriptor],
            features: [
              { ...descriptor, name: 'node.read', aliasOf: 'get_node' },
              ...['workspace.remove', 'workspace.rebind', 'workspace.default.set'].map(name =>
                Object.assign({}, descriptor, {
                  name,
                  inputSchema: {
                    type: 'object',
                    properties: { workspaceId: { type: 'string' } },
                    required: ['workspaceId'],
                  },
                }),
              ),
            ],
          }),
          serviceJobs: async () => ({ jobs: [] }),
          serviceJobCreate: async input => {
            globalThis.calls.push(input);
            return {
              job: {
                id: '00000000-0000-4000-8000-000000000001',
                type: 'tool',
                name: 'get_node',
                status: 'unknown',
                workspaceId: null,
                operationId: 'actual-fixture-operation',
                approvals: [],
                actions: [
                  {
                    action: 'inspect',
                    enabled: false,
                    reason: 'Retained inspection is unavailable.',
                  },
                ],
                result: null,
                error: null,
                outputHash: 'sha256:' + 'a'.repeat(64),
                outputBytes: 10,
                outputUnavailable: 'RESULT_NOT_RETAINED_AFTER_RESTART',
              },
            };
          },
        },
      });
    });
    /* eslint-disable no-await-in-loop -- Each selection replaces the same owned Chrome form. */
    for (const name of ['workspace.remove', 'workspace.rebind', 'workspace.default.set']) {
      await page.locator(`[data-function-id="feature:${name}"]`).click();
      const option = page
        .getByLabel('입력.workspaceId', { exact: true })
        .locator('option[value="00000000-0000-4000-8000-000000000099"]');
      assert.equal(await option.isDisabled(), name === 'workspace.default.set');
      if (name !== 'workspace.default.set') {
        await page
          .getByLabel('입력.workspaceId', { exact: true })
          .selectOption('00000000-0000-4000-8000-000000000099');
        await page.getByRole('button', { name: '입력과 대상 검토' }).click();
        const preview = JSON.parse(await page.locator('#service-preview-json').textContent());
        assert.equal(preview.args.workspaceId, '00000000-0000-4000-8000-000000000099');
        assert.equal(preview.workspaceId, null);
      }
    }
    /* eslint-enable no-await-in-loop */
    await page.locator('[data-function-id="feature:node.read"]').click();
    await page
      .getByText('같은 기능의 MCP 경로: get_node. 별도의 고유 기능으로 합산하지 않습니다.', {
        exact: true,
      })
      .waitFor();
    await page.locator('[data-function-id="tool:get_node"]').click();
    await page.getByLabel('입력.nodeId', { exact: true }).fill('1:2');
    await page.locator('select[name=targetKind]').selectOption('active');
    await page.getByRole('button', { name: '입력과 대상 검토' }).click();
    assert.deepEqual(await page.evaluate(() => globalThis.calls), []);
    await page.locator('#service-request-submit').click();
    await page
      .locator('#service-job-detail')
      .getByText('응답 원문을 현재 보관하지 않습니다', { exact: false })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.calls), [
      {
        type: 'tool',
        name: 'get_node',
        args: { nodeId: '1:2' },
        workspaceId: null,
        targetSelector: { kind: 'active' },
      },
    ]);
    assert.equal(await page.locator('[data-job-action=inspect]').count(), 0);
    assert.equal(await page.locator('[data-function-id]').count(), 5);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolveClose, reject) =>
      server.close(error => (error ? reject(error) : resolveClose())),
    );
  }
}, 30000);
