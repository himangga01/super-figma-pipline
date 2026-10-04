type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const transform = (value: unknown) => {
  const m = object(value);
  return [
    [m.m00 ?? 1, m.m01 ?? 0, m.m02 ?? 0],
    [m.m10 ?? 0, m.m11 ?? 1, m.m12 ?? 0],
  ];
};

/** Convert native paint records; original image references stay content-addressed. */
export function normalizeNativePaints(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map(input => {
    const paint = object(input),
      color = object(paint.color);
    const result: Row = {
      type: paint.type,
      visible: paint.visible ?? true,
      opacity: paint.opacity ?? 1,
      blendMode: paint.blendMode ?? 'NORMAL',
    };
    if (paint.type === 'SOLID') {
      result.color = { r: color.r, g: color.g, b: color.b };
      result.opacity = Number(result.opacity) * Number(color.a ?? 1);
      result.boundVariables = {};
    } else if (String(paint.type).startsWith('GRADIENT_')) {
      result.gradientStops = (Array.isArray(paint.stops) ? paint.stops : []).map(stop => {
        const row = object(stop);
        return { color: row.color, position: row.position, boundVariables: {} };
      });
      result.gradientTransform = transform(paint.transform);
    } else if (paint.type === 'IMAGE') {
      const image = object(paint.animatedImage ?? paint.image),
        filters = object(paint.imageFilters ?? paint.filters);
      result.scaleMode = paint.imageScaleMode ?? 'FILL';
      result.scalingFactor = paint.scale ?? 0.5;
      result.rotation = paint.rotation ?? 0;
      result.imageTransform = transform(paint.transform);
      result.filters = Object.fromEntries(
        ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'].map(
          key => [key, filters[key] ?? 0],
        ),
      );
      if (image.hash instanceof Uint8Array)
        result.imageHash = Buffer.from(image.hash).toString('hex');
      else result.nativeImageUnavailable = true;
    } else result.nativePaintUnsupported = true;
    return result;
  });
}
