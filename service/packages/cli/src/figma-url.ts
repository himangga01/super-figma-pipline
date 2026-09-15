export interface FigmaTarget {
  fileKey: string;
  nodeId: string | null;
  url: string;
  desktopUrl: string;
}

export const parseFigmaTarget = (input: string): Readonly<FigmaTarget> => {
  const url = new URL(input);
  const match = /^\/(design|file|proto)\/([A-Za-z0-9]{10,128})(?:\/[^/]*)?\/?$/u.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    !['www.figma.com', 'figma.com'].includes(url.hostname) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    match === null
  ) {
    throw new Error('FIGMA_URL_INVALID: provide an https Figma design/file/prototype URL');
  }
  const rawNode = url.searchParams.get('node-id');
  const nodeId = rawNode === null ? null : rawNode.replace(/^(\d+)-(\d+)$/u, '$1:$2');
  if (nodeId !== null && (nodeId.length > 512 || !/^I?\d+:\d+(?:;I?\d+:\d+)*$/u.test(nodeId)))
    throw new Error('FIGMA_NODE_ID_INVALID');
  const clean = new URL(`https://www.figma.com/${match[1]}/${match[2]}`);
  if (nodeId !== null)
    clean.searchParams.set(
      'node-id',
      /^\d+:\d+$/u.test(nodeId) ? nodeId.replace(':', '-') : nodeId,
    );
  return Object.freeze({
    fileKey: match[2]!,
    nodeId,
    url: clean.href,
    desktopUrl: clean.href.replace('https://www.figma.com/', 'figma://'),
  });
};

export const assertLoopbackCdp = (input: string): string => {
  const url = new URL(input);
  if (
    !['http:', 'ws:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('CHROME_CDP_INVALID: use a loopback Chrome debugging endpoint');
  }
  return url.href;
};
