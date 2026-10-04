import { win32 } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs', () => ({
  statSync: (path: string) => {
    if (!files.has(path)) throw new Error('ENOENT');
    return { isFile: () => files.get(path) !== 'directory' };
  },
  realpathSync: { native: (path: string) => files.get(path) },
}));

import { googleChromeExecutable } from '../../src/portal/chrome-runtime.js';

beforeEach(() => files.clear());

it('finds and canonicalizes the installed system Google Chrome on Windows', () => {
  const path = win32.join('D:\\Applications', 'Google', 'Chrome', 'Application', 'chrome.exe');
  files.set(path, 'D:\\ChromeStable\\chrome.exe');
  expect(
    googleChromeExecutable({
      platform: 'win32',
      environment: { ProgramFiles: 'D:\\Applications' },
    }),
  ).toBe('D:\\ChromeStable\\chrome.exe');
});

it('finds a per-user installation when the Windows owner path contains Korean characters', () => {
  const root = 'C:\\Users\\사용자\\AppData\\Local';
  const path = win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
  files.set(path, path);
  expect(googleChromeExecutable({ platform: 'win32', environment: { LOCALAPPDATA: root } })).toBe(
    path,
  );
});

it.each([
  ['darwin', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['linux', '/opt/google/chrome/chrome'],
  ['linux', '/usr/bin/google-chrome-stable'],
] as const)('resolves the installed stable Chrome on %s at %s', (platform, path) => {
  files.set(path, path);
  expect(googleChromeExecutable({ platform, environment: {} })).toBe(path);
});

it.each(['win32', 'darwin', 'linux', 'freebsd'] as const)(
  'returns an explicit missing prerequisite on %s without selecting a bundled browser',
  platform => {
    files.set('bundled-browser', 'bundled-browser');
    expect(googleChromeExecutable({ platform, environment: {} })).toBeUndefined();
  },
);

it('rejects a directory at the expected executable path', () => {
  files.set('/opt/google/chrome/chrome', 'directory');
  expect(googleChromeExecutable({ platform: 'linux', environment: {} })).toBeUndefined();
});
