import { storedChecksum } from '@sfp/ir';
import { expect, it } from 'vitest';

import { inspectCoreComponentReference } from '../../src/portal/recipes/consumption-components.js';
const files = (values: Record<string, string>) =>
  new Map(
    Object.entries(values).map(([path, text]) => [
      path,
      { bytes: Buffer.from(text), hash: storedChecksum(text) },
    ]),
  );

it('binds a named React component export, alias and actual JSX reference to exact source bytes', () => {
  const input = files({
    'package.json': '{}',
    'Button.tsx': 'export function Button(){return <button>Save</button>}',
    'App.tsx':
      'import {Button as Save} from "./Button";export default function App(){return <Save/>}',
  });
  const proof = inspectCoreComponentReference(input, {
    componentPath: 'Button.tsx',
    exportName: 'Button',
    consumerPath: 'App.tsx',
  });
  expect(proof.references).toEqual([{ local: 'Save', kind: 'jsx', offset: expect.any(Number) }]);
  expect(input.get('App.tsx')!.bytes.toString().slice(proof.references[0]!.offset)).toMatch(
    /^<Save/u,
  );
  expect(proof.componentHash).toBe(input.get('Button.tsx')!.hash);
});
it('rejects an unused import, type-only import and shadowed local symbol', () => {
  for (const content of [
    'import {Button} from "./Button";export default function App(){return <div/>}',
    'import type {Button} from "./Button";export default function App(){return <div/>}',
    'import {Button} from "./Button";export function App(Button:any){return <Button/>}',
  ]) {
    expect(() =>
      inspectCoreComponentReference(
        files({
          'package.json': '{}',
          'Button.tsx': 'export function Button(){return <button/>}',
          'App.tsx': content,
        }),
        { componentPath: 'Button.tsx', exportName: 'Button', consumerPath: 'App.tsx' },
      ),
    ).toThrow(/REFERENCE_MISSING|IMPORT_MISSING|SYMBOL_AMBIGUOUS/u);
  }
});
it('uses the actual Vue template parser and excludes commented component tags', () => {
  const base = { 'package.json': '{}', 'Button.vue': '<template><button>Save</button></template>' };
  const live = files({
    ...base,
    'App.vue':
      '<script setup>import SaveButton from "./Button.vue";</script><template><save-button/></template>',
  });
  expect(
    inspectCoreComponentReference(live, {
      componentPath: 'Button.vue',
      exportName: 'default',
      consumerPath: 'App.vue',
    }).references[0]?.kind,
  ).toBe('vue-template');
  const unused = files({
    ...base,
    'App.vue':
      '<script setup>import SaveButton from "./Button.vue";</script><template><!-- <save-button/> --><div>Unrelated</div></template>',
  });
  expect(() =>
    inspectCoreComponentReference(unused, {
      componentPath: 'Button.vue',
      exportName: 'default',
      consumerPath: 'App.vue',
    }),
  ).toThrow('REFERENCE_MISSING');
});
it('rejects changed bytes, absent exports and unsupported external Vue templates', () => {
  const input = files({
    'package.json': '{}',
    'Button.tsx': 'const Button=()=> <button/>;',
    'App.tsx': 'import {Button} from "./Button";const view=<Button/>;',
  });
  expect(() =>
    inspectCoreComponentReference(input, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'App.tsx',
    }),
  ).toThrow('EXPORT_MISSING');
  input.get('App.tsx')!.bytes = Buffer.from('changed');
  expect(() =>
    inspectCoreComponentReference(input, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'App.tsx',
    }),
  ).toThrow('SOURCE_CHANGED');
  const external = files({
    'Button.vue': '<template src="./external.html"/>',
    'App.vue':
      '<script setup>import Button from "./Button.vue";</script><template><Button/></template>',
    'external.html': '<button/>',
  });
  expect(() =>
    inspectCoreComponentReference(external, {
      componentPath: 'Button.vue',
      exportName: 'default',
      consumerPath: 'App.vue',
    }),
  ).toThrow('SFC_UNSUPPORTED');
});

it('resolves a real barrel alias and binds intermediate configuration/source bytes', () => {
  const input = files({
    'package.json': '{}',
    'Button.tsx': 'export default function Button(){return <button/>}',
    'index.ts': 'export {default as Button} from "./Button";',
    'App.tsx': 'import {Button as Save} from "./index";export const App=()=> <Save/>;',
  });
  const request = { componentPath: 'Button.tsx', exportName: 'default', consumerPath: 'App.tsx' };
  const first = inspectCoreComponentReference(input, request);
  expect(first.references[0]?.local).toBe('Save');
  const changed = 'export {default as Button} from "./Button"; export const version=2;';
  input.set('index.ts', { bytes: Buffer.from(changed), hash: storedChecksum(changed) });
  expect(inspectCoreComponentReference(input, request).sourceClosureHash).not.toBe(
    first.sourceClosureHash,
  );
});

it('resolves namespace JSX references and refuses re-export cycles', () => {
  const input = files({
    'package.json': '{}',
    'Button.tsx': 'export function Button(){return <button/>}',
    'App.tsx': 'import * as UI from "./Button";export const App=()=> <UI.Button/>;',
  });
  expect(
    inspectCoreComponentReference(input, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'App.tsx',
    }).references[0]?.local,
  ).toBe('UI.Button');
  const cycle = files({
    'package.json': '{}',
    'Button.tsx': 'export function Button(){return <button/>}',
    'one.ts': 'export * from "./two";',
    'two.ts': 'export * from "./one";',
    'App.tsx': 'import {Button} from "./one";export const App=()=> <Button/>;',
  });
  expect(() =>
    inspectCoreComponentReference(cycle, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'App.tsx',
    }),
  ).toThrow('IMPORT_MISSING');
});

it('rejects destructured, defaulted, array and same-file shadow bindings', () => {
  const source = 'export function Button(){return <button/>}';
  for (const parameter of [
    '{Button}:any',
    '{nested:{Button}}:any',
    '[Button]:any',
    'Button:any=()=>null',
    '...Button:any[]',
  ]) {
    const input = files({
      'package.json': '{}',
      'Button.tsx': source,
      'App.tsx': `import {Button} from "./Button";export function App(${parameter}){return <Button/>}`,
    });
    expect(() =>
      inspectCoreComponentReference(input, {
        componentPath: 'Button.tsx',
        exportName: 'Button',
        consumerPath: 'App.tsx',
      }),
    ).toThrow('SYMBOL_AMBIGUOUS');
  }
  const same = files({
    'Button.tsx': source + ';export function App({Button}:any){return <Button/>}',
  });
  expect(() =>
    inspectCoreComponentReference(same, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'Button.tsx',
    }),
  ).toThrow('SYMBOL_AMBIGUOUS');
  const direct = files({ 'Button.tsx': source + ';export function App(){return <Button/>}' });
  expect(
    inspectCoreComponentReference(direct, {
      componentPath: 'Button.tsx',
      exportName: 'Button',
      consumerPath: 'Button.tsx',
    }).references,
  ).toHaveLength(1);
});

it('requires actual Vue template exposure from script setup or component registration', () => {
  const base = {
    'package.json': '{"dependencies":{"vue":"3.5.42"}}',
    'Button.vue': '<template><button>Save</button></template>',
  };
  const request = { componentPath: 'Button.vue', exportName: 'default', consumerPath: 'App.vue' };
  const hidden = files({
    ...base,
    'App.vue':
      '<script>import SaveButton from "./Button.vue";export default {};</script><template><SaveButton/></template>',
  });
  expect(() => inspectCoreComponentReference(hidden, request)).toThrow('REFERENCE_MISSING');
  for (const declaration of [
    '{components:{SaveButton}}',
    'defineComponent({components:{SaveButton}})',
  ]) {
    const input = files({
      ...base,
      'App.vue': `<script>import {defineComponent} from "vue";import SaveButton from "./Button.vue";export default ${declaration};</script><template><SaveButton/></template>`,
    });
    expect(inspectCoreComponentReference(input, request).references[0]?.local).toBe('SaveButton');
  }
  const alias = files({
    ...base,
    'App.vue':
      '<script>import SaveButton from "./Button.vue";export default {components:{Primary:SaveButton}};</script><template><Primary/></template>',
  });
  expect(inspectCoreComponentReference(alias, request).references[0]?.local).toBe('SaveButton');
  const returned = files({
    ...base,
    'App.vue':
      '<script>import SaveButton from "./Button.vue";export default {setup(){return {SaveButton}}};</script><template><SaveButton/></template>',
  });
  expect(() => inspectCoreComponentReference(returned, request)).toThrow('REFERENCE_MISSING');
});

it('does not credit native HTML, the SFC wrapper or a slot-local name to an imported component', () => {
  const base = { 'package.json': '{}', 'Button.vue': '<template><button>Save</button></template>' };
  const request = { componentPath: 'Button.vue', exportName: 'default', consumerPath: 'App.vue' };
  for (const [local, template] of [
    ['Button', '<button>Native</button>'],
    ['Template', '<div/>'],
    ['Button', '<Shell v-slot="{Button}"><Button/></Shell>'],
  ]) {
    const input = files({
      ...base,
      'App.vue': `<script setup>import ${local} from "./Button.vue";</script><template>${template}</template>`,
    });
    expect(() => inspectCoreComponentReference(input, request)).toThrow(
      /REFERENCE_MISSING|SYMBOL_AMBIGUOUS/u,
    );
  }
});

it('uses actual Vue option and component-property order instead of collecting overwritten bindings', () => {
  const base = { 'package.json': '{}', 'Button.vue': '<template><button>Save</button></template>' };
  const request = { componentPath: 'Button.vue', exportName: 'default', consumerPath: 'App.vue' };
  const check = (options: string) =>
    inspectCoreComponentReference(
      files({
        ...base,
        'App.vue': `<script>import SaveButton from "./Button.vue";const components="unrelated",other={};export default ${options};</script><template><SaveButton/></template>`,
      }),
      request,
    );
  for (const options of [
    '{[components]:{SaveButton}}',
    '{components:{SaveButton},...{components:{}}}',
    '{components:{SaveButton},...other}',
    '{components:{SaveButton,...other}}',
    '{components:{SaveButton,SaveButton:other}}',
    '{components:{SaveButton},components:{}}',
  ])
    expect(() => check(options)).toThrow('REFERENCE_MISSING');
  for (const options of [
    '{["components"]:{SaveButton}}',
    '{...other,components:{SaveButton}}',
    '{components:{...other,SaveButton}}',
    '{...{components:{SaveButton}}}',
  ])
    expect(check(options).references[0]?.local).toBe('SaveButton');
});
