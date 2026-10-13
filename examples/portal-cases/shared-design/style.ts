import type { CSSProperties } from 'react';
import type { Color, IndexedFacts, NodeProperties, Paint } from './types';

/** Generic calculations reused from the reviewed renderer. No captured values or control IDs. */
export function cssColor(color: Color, opacity = 1) { return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${(color.a ?? 1) * opacity})`; }
export function gradient(paint: Paint) {
  if (!paint.gradientStops?.length) throw Error('OWN_CASE_GRADIENT_REQUIRED');
  const matrix = paint.gradientTransform;
  const angle = matrix ? Math.atan2(matrix[0][0], matrix[0][1]) * 180 / Math.PI + 180 : 180;
  return `linear-gradient(${angle}deg,${paint.gradientStops.map(stop => `${cssColor(stop.color)} ${stop.position * 100}%`).join(',')})`;
}
export function textStyle(p: NodeProperties, facts: IndexedFacts): CSSProperties {
  const native = facts.geometryIndex[p.id], segment = p.textSegments?.[0] ?? p, font = native?.fonts?.[0];
  const family = segment.fontName?.family ?? p.fontName?.family ?? font?.family;
  const fill = (p.fills ?? segment.fills ?? []).find(paint => paint.visible !== false && paint.type === 'SOLID');
  const spacing = p.letterSpacing ?? segment.letterSpacing, height = p.lineHeight ?? segment.lineHeight;
  const size = native?.paintedFontSizes?.length === 1 ? native.paintedFontSizes[0] : p.fontSize ?? segment.fontSize;
  const align: Record<string, CSSProperties['textAlign']> = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFIED: 'justify' };
  return { fontFamily: family ? `"${family}",sans-serif` : 'inherit', fontSize: size, fontWeight: p.fontWeight ?? segment.fontWeight ?? font?.weight, fontStyle: segment.fontName?.style.includes('Italic') ? 'italic' : 'normal', letterSpacing: spacing?.unit === 'PERCENT' ? `${spacing.value / 100}em` : spacing?.value, lineHeight: height?.unit === 'PERCENT' ? height.value / 100 : height?.unit === 'PIXELS' ? `${height.value}px` : 'normal', color: native?.paint.fill ?? (fill?.color ? cssColor(fill.color, fill.opacity ?? 1) : 'inherit'), textAlign: p.textAlignHorizontal ? align[p.textAlignHorizontal] : undefined, textTransform: p.textCase === 'UPPER' ? 'uppercase' : p.textCase === 'LOWER' ? 'lowercase' : 'none', textDecoration: p.textDecoration === 'UNDERLINE' ? 'underline' : p.textDecoration === 'STRIKETHROUGH' ? 'line-through' : 'none' };
}
export function nodeStyle(p: NodeProperties, facts: IndexedFacts, isRoot = false): CSSProperties {
  const style: CSSProperties = { position: isRoot ? 'relative' : 'absolute', boxSizing: 'border-box', left: isRoot ? 0 : p.x, top: isRoot ? 0 : p.y, width: p.width, height: p.height, opacity: p.opacity ?? 1, overflow: p.clipsContent ? 'hidden' : 'visible', borderTopLeftRadius: p.topLeftRadius ?? p.cornerRadius, borderTopRightRadius: p.topRightRadius ?? p.cornerRadius, borderBottomLeftRadius: p.bottomLeftRadius ?? p.cornerRadius, borderBottomRightRadius: p.bottomRightRadius ?? p.cornerRadius, paddingTop: p.paddingTop, paddingRight: p.paddingRight, paddingBottom: p.paddingBottom, paddingLeft: p.paddingLeft, gap: p.itemSpacing };
  const solid = p.fills?.find(paint => paint.visible !== false && paint.type === 'SOLID');
  if (solid?.color && p.type !== 'TEXT') style.backgroundColor = cssColor(solid.color, solid.opacity ?? 1);
  const gif = p.fills?.find(paint => paint.visible !== false && paint.type === 'IMAGE' && paint.imageHash && facts.imageAssets[paint.imageHash]?.path.endsWith('.gif'));
  if (gif?.imageHash) { style.backgroundImage = `url("/${facts.imageAssets[gif.imageHash].path}")`; style.backgroundSize = gif.scaleMode === 'FIT' ? 'contain' : 'cover'; style.backgroundPosition = 'center'; style.backgroundRepeat = 'no-repeat'; }
  const shadows = (p.effects ?? []).filter(effect => effect.visible !== false && effect.type === 'DROP_SHADOW').map(effect => `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread ?? 0}px ${cssColor(effect.color)}`);
  const stroke = p.strokes?.find(paint => paint.visible !== false && paint.type === 'SOLID');
  if (stroke?.color && p.type !== 'TEXT') {
    Object.assign(style, { '--source-stroke-color': cssColor(stroke.color, stroke.opacity ?? 1) });
    style.borderColor = 'var(--source-stroke-color)'; style.borderWidth = 0; style.borderStyle = 'solid';
    shadows.unshift(`inset 0 0 0 ${p.strokeWeight ?? 0}px var(--source-stroke-color)`);
  }
  if (p.type !== 'TEXT' && shadows.length) style.boxShadow = shadows.join(',');
  const matrix = p.relativeTransform;
  if (!isRoot && matrix && (matrix[0][0] !== 1 || matrix[0][1] !== 0 || matrix[1][0] !== 0 || matrix[1][1] !== 1)) { style.transform = `matrix(${matrix[0][0]},${matrix[1][0]},${matrix[0][1]},${matrix[1][1]},0,0)`; style.transformOrigin = '0 0'; }
  if (p.type === 'TEXT') { if (!facts.geometryIndex[p.id]) throw Error('OWN_CASE_TEXT_GEOMETRY_REQUIRED'); Object.assign(style, textStyle(p, facts)); }
  return style;
}
