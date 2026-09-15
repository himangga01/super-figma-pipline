import { canonicalFileIdentityHash, type ControlStatusV1 } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { ControlClient } from '../src/control-client.js';
import { assertDesktopTarget, readDesktopDesign } from '../src/desktop-reader.js';
import { parseFigmaTarget } from '../src/figma-url.js';

describe('desktop connection automation', () => {
  const response = (name: string): unknown =>
    name === 'get_metadata'
      ? { currentPage: { id: '0:1', name: 'Page' }, pages: [{ id: '0:1', name: 'Page' }] }
      : name === 'get_document'
        ? { pageId: '0:1', children: [] }
        : name === 'get_selection'
          ? { nodes: [] }
          : { name };

  it('rejects a different file and an unverified identity before reading', () => {
    const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS');
    const status = {
      pairedPluginCount: 1,
      activePlugin: {
        sessionId: 'pinned',
        fileIdentityKind: 'figma-file-key',
        fileIdentityHash: canonicalFileIdentityHash({
          kind: 'figma-file-key',
          value: target.fileKey,
        }),
      },
    } as ControlStatusV1;
    expect(assertDesktopTarget(status, target)).toBe('pinned');
    expect(() => assertDesktopTarget(status, { ...target, fileKey: 'AnotherFile1234' })).toThrow(
      'DESKTOP_FILE_MISMATCH',
    );
    expect(() =>
      assertDesktopTarget(
        {
          ...status,
          activePlugin: { ...status.activePlugin!, fileIdentityKind: 'unstable-readonly' },
        },
        target,
      ),
    ).toThrow('DESKTOP_FILE_IDENTITY_UNVERIFIED');
  });

  it('rejects mixed pages and reads an explicitly requested node', async () => {
    const mixed = vi.fn<ControlClient['readTool']>(async name =>
      name === 'get_document' ? { pageId: '0:2' } : response(name),
    );
    await expect(readDesktopDesign({ readTool: mixed }, 'session', null)).rejects.toThrow(
      'DESKTOP_PAGE_CHANGED',
    );
    const selected = vi.fn<ControlClient['readTool']>(async name =>
      name === 'get_node' ? { node: { id: '1:2' } } : response(name),
    );
    const capture = await readDesktopDesign(
      { readTool: selected },
      'session',
      null,
      undefined,
      '1:2',
    );
    expect(selected).toHaveBeenCalledWith('get_node', { nodeId: '1:2' }, 'session');
    expect(capture.scope).toEqual({ nodeId: '1:2', pageId: null, pageName: null });
    expect(selected.mock.calls.some(call => call[0] === 'get_document')).toBe(false);
  });

  it('reads a whole page when the selection is empty and pins the session', async () => {
    const readTool = vi.fn<ControlClient['readTool']>(async name => response(name));
    const capture = await readDesktopDesign({ readTool }, 'paired-session', null);
    expect(capture.selection).toEqual({ nodes: [] });
    expect(capture.document).toEqual({ pageId: '0:1', children: [] });
    expect(readTool.mock.calls.every(call => call[2] === 'paired-session')).toBe(true);
    expect(capture.project).toBeNull();
  });
  it('analyzes the registered target service automatically when supplied', async () => {
    const readTool = vi.fn<ControlClient['readTool']>(async name => response(name));
    const capture = await readDesktopDesign(
      { readTool },
      'paired-session',
      'workspace-id',
      '/project',
    );
    expect(readTool).toHaveBeenCalledWith(
      'analyze_project',
      { rootDir: '/project' },
      'paired-session',
      'workspace-id',
    );
    expect(readTool).toHaveBeenCalledWith(
      'scan_components',
      { rootDir: '/project' },
      'paired-session',
      'workspace-id',
    );
    expect(capture.project?.components).toEqual({ name: 'scan_components' });
  });
  it('issues the pairing challenge without a request body', async () => {
    const client = new ControlClient();
    const request = vi
      .spyOn(client, 'request')
      .mockResolvedValue({ challengeId: 'ABCDEFGHIJ', code: '12345678' });
    expect(await client.pairCode()).toBe('SFP-ABCDEFGHIJ-12345678');
    expect(request).toHaveBeenCalledWith('/control/pair/challenge', 'POST');
  });
  it('refuses a write tool in the read automation interface', async () => {
    const client = new ControlClient();
    const request = vi.spyOn(client, 'request').mockResolvedValue({});
    await expect(client.readTool('delete_nodes', {}, 'session')).rejects.toThrow(
      /AUTOMATION_READ_ONLY/,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
