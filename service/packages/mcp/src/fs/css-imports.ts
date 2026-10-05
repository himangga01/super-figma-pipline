import { posix } from 'node:path';

export interface CssImport {
  offset: number;
  specifier: string | null;
}
/** Read literal CSS imports outside comments and strings; unknown syntax stays explicit. */
export function cssImports(text: string): CssImport[] {
  const found: CssImport[] = [];
  for (let at = 0; at < text.length;) {
    if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      at = end < 0 ? text.length : end + 2;
      continue;
    }
    const quote = text[at];
    if (quote === '"' || quote === "'") {
      at++;
      while (at < text.length && text[at] !== quote) at += text[at] === '\\' ? 2 : 1;
      at++;
      continue;
    }
    if (!/^@import\b/iu.test(text.slice(at, at + 8))) {
      at++;
      continue;
    }
    const offset = at;
    const end = text.indexOf(';', at);
    const body = text.slice(at + 7, end < 0 ? text.length : end).trim();
    const match =
      /^(?:(["'])([^"'\\]+)\1|url\(\s*(?:(["'])([^"'\\]+)\3|([^\s"'\\()]+))\s*\))/iu.exec(body);
    found.push({
      offset,
      specifier: end < 0 || !match ? null : (match[2] ?? match[4] ?? match[5] ?? null),
    });
    at = end < 0 ? text.length : end + 1;
  }
  return found;
}
export const localCssImport = (from: string, specifier: string): string | null =>
  (/^[.]{1,2}\//u.test(specifier) || /^[^/:]+(?:\/[^/:]+)*\.css$/u.test(specifier)) &&
  !/[?#\\]/u.test(specifier)
    ? posix.normalize(posix.join(posix.dirname(from), specifier))
    : null;
