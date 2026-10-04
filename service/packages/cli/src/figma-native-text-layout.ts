type Row = Record<string, unknown>;
const row = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const point = (value: unknown) => {
  const valueRow = row(value);
  return valueRow && finite(valueRow.x) && finite(valueRow.y)
    ? { x: valueRow.x, y: valueRow.y }
    : null;
};

/** Retain native derived layout separately; it is not a live Plugin API observation. */
export function readNativeTextLayout(input: unknown, characters: unknown) {
  const value = row(input);
  if (!value || typeof characters !== 'string' || characters.length > 65536) return null;
  const layoutSize = point(value.layoutSize);
  if (
    !layoutSize ||
    layoutSize.x < 0 ||
    layoutSize.y < 0 ||
    !Array.isArray(value.baselines) ||
    !value.baselines.length ||
    value.baselines.length > 4096 ||
    !Array.isArray(value.glyphs) ||
    value.glyphs.length > 65536
  )
    return null;
  const baselines = [];
  let previousEnd = 0;
  for (const item of value.baselines) {
    const line = row(item),
      position = point(line?.position);
    if (
      !line ||
      !position ||
      !finite(line.width) ||
      line.width < 0 ||
      !finite(line.lineHeight) ||
      line.lineHeight <= 0 ||
      !Number.isInteger(line.firstCharacter) ||
      !Number.isInteger(line.endCharacter)
    )
      return null;
    const firstCharacter = line.firstCharacter as number,
      endCharacter = line.endCharacter as number;
    if (
      firstCharacter < previousEnd ||
      endCharacter <= firstCharacter ||
      endCharacter > characters.length
    )
      return null;
    previousEnd = endCharacter;
    baselines.push({
      position,
      width: line.width,
      lineHeight: line.lineHeight,
      firstCharacter,
      endCharacter,
    });
  }
  const glyphFontSizes = new Set<number>();
  const glyphPositions: Array<{ index: number; x: number; y: number }> = [];
  let positionsComplete = true;
  const indices = new Set<number>();
  for (const item of value.glyphs) {
    const glyph = row(item);
    if (!glyph || !finite(glyph.fontSize) || glyph.fontSize <= 0) return null;
    glyphFontSizes.add(glyph.fontSize);
    const position = point(glyph.position),
      index = glyph.firstCharacter;
    if (
      !position ||
      !Number.isInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= characters.length ||
      indices.has(index as number) ||
      (glyph.rotation !== undefined && glyph.rotation !== 0)
    )
      positionsComplete = false;
    else {
      indices.add(index as number);
      glyphPositions.push({ index: index as number, ...position });
    }
  }
  return {
    version: 1,
    coordinateSpace: 'native-derived-text',
    characters,
    layoutSize,
    baselines,
    glyphFontSizes: [...glyphFontSizes],
    ...(positionsComplete && glyphPositions.length
      ? { glyphPositions: glyphPositions.toSorted((a, b) => a.index - b.index) }
      : {}),
  };
}
