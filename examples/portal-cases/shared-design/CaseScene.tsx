import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { normalizeGlyphPath } from './facts';
import { cssColor, gradient, nodeStyle, textStyle } from './style';
import { sourceBackdrop } from './composition';
import type { Composition } from './composition';
import type { CapturedAsset, CapturedNode, ControlRenderer, IndexedFacts, Paint, SourceComponentRenderer } from './types';
import './case-scene.css';

type DecodedFrame = { image: CanvasImageSource & { close(): void } };
type Decoder = { decode(input: { frameIndex: number; completeFramesOnly: boolean }): Promise<DecodedFrame>; close(): void };
type DecoderConstructor = new (input: { data: ArrayBuffer; type: string; preferAnimation: boolean }) => Decoder;

/** Chrome WebCodecs first-frame handling, scoped to each supplied immutable current asset. */
function GifFrame({ asset, paint }: { asset: CapturedAsset; paint: Paint }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false), [failure, setFailure] = useState<Error | null>(null);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function render() {
      const DecoderClass = (globalThis as typeof globalThis & { ImageDecoder?: DecoderConstructor }).ImageDecoder;
      if (!DecoderClass) throw Error('OWN_CASE_IMAGE_DECODER_REQUIRED');
      const response = await fetch('/' + asset.path, { credentials: 'omit', redirect: 'error', cache: 'force-cache', signal: controller.signal });
      if (!response.ok) throw Error('OWN_CASE_ASSET_REQUIRED');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== asset.bytes) throw Error('OWN_CASE_ASSET_SIZE_CHANGED');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      if ('sha256:' + digest !== asset.sha256) throw Error('OWN_CASE_ASSET_HASH_CHANGED');
      const decoder = new DecoderClass({ data: bytes, type: 'image/gif', preferAnimation: false });
      try {
        const frame = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
        try {
          const bitmap = await createImageBitmap(frame.image);
          try { const canvas = ref.current; if (!disposed && canvas) { canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d'); if (!context) throw Error('OWN_CASE_CANVAS_REQUIRED'); context.drawImage(bitmap, 0, 0); setReady(true); } }
          finally { bitmap.close(); }
        } finally { frame.image.close(); }
      } finally { decoder.close(); }
    }
    render().catch(error => { if (!disposed) setFailure(error instanceof Error ? error : Error('OWN_CASE_ASSET_FRAME_FAILED')); });
    return () => { disposed = true; controller.abort(); };
  }, [asset.path, asset.bytes, asset.sha256]);
  if (failure) throw failure;
  return <canvas ref={ref} className="case-paint-layer" data-source-asset={asset.id} data-source-frame="0" data-asset-ready={String(ready)} aria-hidden="true" style={{ opacity: paint.opacity ?? 1, objectFit: paint.scaleMode === 'FIT' ? 'contain' : 'cover' }} />;
}

function PaintLayers({ node, facts }: { node: CapturedNode; facts: IndexedFacts }) {
  return (node.properties.fills ?? []).map((paint, index) => {
    if (paint.visible === false || paint.type === 'SOLID') return null;
    if (paint.type === 'GRADIENT_LINEAR') return <span key={index} className="case-paint-layer" aria-hidden="true" style={{ opacity: paint.opacity ?? 1, backgroundImage: gradient(paint) }} />;
    if (paint.type !== 'IMAGE' || !paint.imageHash || !['FILL', 'FIT'].includes(paint.scaleMode ?? '')) throw Error('OWN_CASE_PAINT_UNSUPPORTED');
    const asset = facts.imageAssets[paint.imageHash];
    if (!asset) throw Error('OWN_CASE_IMAGE_REQUIRED');
    return asset.path.endsWith('.gif') ? <GifFrame key={index} asset={asset} paint={paint} /> : <img key={index} className="case-paint-layer" src={'/' + asset.path} alt="" draggable={false} data-source-asset={asset.id} style={{ opacity: paint.opacity ?? 1, objectFit: paint.scaleMode === 'FIT' ? 'contain' : 'cover' }} />;
  });
}

export function CapturedText({ node, facts }: { node: CapturedNode; facts: IndexedFacts }) {
  const titleId = useId(), record = facts.geometryIndex[node.id];
  if (!record || !Array.isArray(record.glyphs)) throw Error('OWN_CASE_TEXT_GEOMETRY_REQUIRED');
  const glyphs = record.glyphs.map(glyph => {
    const resource = facts.resourceIndex[glyph.resourceId];
    if (!resource || normalizeGlyphPath(resource.d) !== resource.d || !Array.isArray(glyph.transform) || glyph.transform.length !== 6 || !glyph.transform.every(Number.isFinite)) throw Error('OWN_CASE_GLYPH_RESOURCE_INVALID');
    return { ...glyph, resource };
  });
  return <svg className="case-captured-text-svg" width={record.width} height={record.height} role="img" aria-labelledby={titleId} focusable={false} style={{ filter: record.paint.filter, opacity: record.paint.opacity }} data-glyph-source="own-current-public-native-geometry" data-source-document={facts.binding.documentHash}>
    <title id={titleId}>{node.properties.characters ?? ''}</title>
    <g fill={record.paint.fill} stroke={record.paint.stroke} style={{ paintOrder: record.paint.paintOrder }} aria-hidden="true">{glyphs.filter(glyph => glyph.resource.d).map((glyph, index) => <path key={index} d={glyph.resource.d} transform={`matrix(${glyph.transform.join(' ')})`} strokeWidth={glyph.strokeWidth} data-source-character-index={glyph.index} data-source-commands-blob={glyph.commandsBlob} data-source-commands-hash={glyph.resource.commandsHash} data-source-resource={glyph.resourceId} />)}</g>
  </svg>;
}

export function SceneNode({ id, facts, composition, renderControl, wrapNode, isRoot = false }: { id: string; facts: IndexedFacts; composition: Composition; renderControl: ControlRenderer; wrapNode?: SourceComponentRenderer; isRoot?: boolean }) {
  const node = facts.nodeIndex[id];
  if (!node) throw Error('OWN_CASE_NODE_REQUIRED');
  const p = node.properties;
  if (p.visible === false) return null;
  const style = nodeStyle(p, facts, isRoot), parent = node.parentId ? facts.nodeIndex[node.parentId] : undefined;
  if (!isRoot && parent?.properties.type === 'GROUP') {
    if (!p.absoluteBoundingBox || !parent.properties.absoluteBoundingBox) throw Error('OWN_CASE_GROUP_GEOMETRY_REQUIRED');
    style.left = p.absoluteBoundingBox.x - parent.properties.absoluteBoundingBox.x; style.top = p.absoluteBoundingBox.y - parent.properties.absoluteBoundingBox.y;
  }
  const composedParentId = composition.parent[id];
  if (!isRoot && composedParentId && composedParentId !== node.parentId) {
    const receiver = facts.nodeIndex[composedParentId];
    if (!p.absoluteBoundingBox || !receiver.properties.absoluteBoundingBox) throw Error('OWN_CASE_COMPOSITE_BOUNDS_REQUIRED');
    style.left = p.absoluteBoundingBox.x - receiver.properties.absoluteBoundingBox.x; style.top = p.absoluteBoundingBox.y - receiver.properties.absoluteBoundingBox.y;
  }
  const children = composition.children[id].map(child => <SceneNode key={child} id={child} facts={facts} composition={composition} renderControl={renderControl} wrapNode={wrapNode} />);
  const control = renderControl({ node, style, children });
  if (control !== undefined) return <>{wrapNode ? wrapNode(node, control) : control}</>;
  const common = { 'data-sfp-node': id, 'data-sfp-root': isRoot ? id : undefined, 'data-sfp-type': p.type, 'data-source-name': p.name, className: 'case-captured-node' };
  if (p.type === 'TEXT') return <span {...common} style={style}><CapturedText node={node} facts={facts} /></span>;
  if (p.type === 'VECTOR') { const asset = facts.vectorAssets[id]; if (!asset) throw Error('OWN_CASE_VECTOR_REQUIRED'); return <img {...common} style={{ ...style, backgroundColor: 'transparent' }} src={'/' + asset.path} data-sfp-vector={id} alt="" draggable={false} />; }
  const visiblePaints = (p.fills ?? []).filter(paint => paint.visible !== false), images = visiblePaints.filter(paint => paint.type === 'IMAGE');
  if (p.type === 'RECTANGLE' && node.childIds.length === 0 && images.length === 1 && visiblePaints.every(paint => ['IMAGE', 'GRADIENT_LINEAR'].includes(paint.type))) {
    const paint = images[0], asset = paint.imageHash ? facts.imageAssets[paint.imageHash] : undefined;
    if (!asset || !['FILL', 'FIT'].includes(paint.scaleMode ?? '')) throw Error('OWN_CASE_IMAGE_REQUIRED');
    if (composition.heroIds.has(id)) {
      const backdrop = cssColor(sourceBackdrop(node, facts));
      return <div {...common} style={{ ...style, backgroundImage: `url("/${asset.path}")`, backgroundSize: paint.scaleMode === 'FIT' ? 'contain' : 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
        <span className="case-paint-layer" aria-hidden="true" style={{ backgroundColor: backdrop, opacity: 1 - (paint.opacity ?? 1) }} />
        {visiblePaints.filter(value => value.type === 'GRADIENT_LINEAR').map((value, index) => <span key={index} className="case-paint-layer" aria-hidden="true" style={{ opacity: value.opacity ?? 1, backgroundImage: gradient(value) }} />)}{children}
      </div>;
    }
    if (!asset.path.endsWith('.gif')) {
      if (children.length) throw Error('OWN_CASE_IMG_CANNOT_OWN_SOURCE_SLOTS');
      const imageStyle: CSSProperties = { ...style, objectFit: paint.scaleMode === 'FIT' ? 'contain' : 'cover', filter: paint.opacity === undefined || paint.opacity === 1 ? undefined : `opacity(${paint.opacity})` };
      if (visiblePaints.length === 1) return <img {...common} style={imageStyle} src={'/' + asset.path} alt="" draggable={false} data-source-asset={asset.id} />;
      return <div style={{ ...style, opacity: 1, backgroundColor: undefined, boxShadow: undefined }}><img {...common} style={{ ...imageStyle, left: 0, top: 0, transform: undefined }} src={'/' + asset.path} alt="" draggable={false} data-source-asset={asset.id} />{visiblePaints.filter(value => value.type === 'GRADIENT_LINEAR').map((value, index) => <span key={index} className="case-paint-layer" aria-hidden="true" style={{ opacity: value.opacity ?? 1, backgroundImage: gradient(value) }} />)}</div>;
    }
  }
  const Tag = isRoot ? 'main' : 'div';
  const element = <Tag {...common} style={style}><PaintLayers node={node} facts={facts} />{children}</Tag>;
  return <>{wrapNode ? wrapNode(node, element) : element}</>;
}

/** Responsive rules and current roots are supplied by the actual case design binding. */
export function CaseScene({ facts, composition, desktopView, mobileView, breakpoint, fixedView, renderControl, wrapNode }: { facts: IndexedFacts; composition: Composition; desktopView: string; mobileView: string; breakpoint: number; fixedView?: string; renderControl: ControlRenderer; wrapNode?: SourceComponentRenderer }) {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null), [ready, setReady] = useState(false);
  useEffect(() => { const listener = () => setWidth(window.innerWidth); listener(); window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); }, []);
  if (!Number.isFinite(breakpoint) || breakpoint <= 0) throw Error('OWN_CASE_BREAKPOINT_REQUIRED');
  const view = fixedView ?? (width !== null && width < breakpoint ? mobileView : desktopView), scene = facts.views[view];
  if (!scene) throw Error('OWN_CASE_VIEW_REQUIRED');
  useEffect(() => {
    let disposed = false, fontsReady = false;
    setReady(false);
    const update = () => { const root = ref.current; if (!disposed && root) setReady(fontsReady && [...root.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0) && [...root.querySelectorAll('canvas[data-asset-ready]')].every(canvas => canvas.getAttribute('data-asset-ready') === 'true')); };
    const observer = new MutationObserver(update); if (ref.current) observer.observe(ref.current, { attributes: true, subtree: true, attributeFilter: ['data-asset-ready'] });
    const root = ref.current;
    root?.addEventListener('load', update, true); root?.addEventListener('error', update, true);
    document.fonts.ready.then(() => { fontsReady = true; update(); }); update();
    return () => { disposed = true; observer.disconnect(); root?.removeEventListener('load', update, true); root?.removeEventListener('error', update, true); };
  }, [facts, view]);
  const scale = fixedView || width === null ? 1 : Math.min(1, width / scene.width);
  const wrapper: CSSProperties = { width: scene.width * scale, height: scene.contentHeight * scale, position: 'relative', margin: '0 auto' };
  return <div ref={ref} className="case-scene" data-case={facts.binding.caseId} data-plan-id={facts.binding.planId} data-view={view} data-own-current-facts="true" data-current-facts-ready={String(ready)}>
    <div style={wrapper} data-source-root-wrapper={scene.rootId}><div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: scene.width }}><SceneNode key={view} id={scene.rootId} facts={facts} composition={composition} renderControl={renderControl} wrapNode={wrapNode} isRoot /></div></div>
  </div>;
}

/** The real server form owns submission. Its current captured placeholder labels the actual input. */
export function CapturedEmailInput({ node, placeholderId, facts, style, label, value, onChange }: { node: CapturedNode; placeholderId: string; facts: IndexedFacts; style: CSSProperties; label: string; value: string; onChange: (value: string) => void }) {
  const placeholder = facts.nodeIndex[placeholderId];
  if (!placeholder || placeholder.properties.type !== 'TEXT' || !node.childIds.includes(placeholderId)) throw Error('OWN_CASE_EMAIL_PLACEHOLDER_REQUIRED');
  const position = placeholder.properties;
  return <div style={style}><label className="case-captured-node case-placeholder-art" data-sfp-node={placeholder.id} data-sfp-type="TEXT" data-source-name={position.name} style={nodeStyle(position, facts)}>
    <input data-sfp-node={node.id} data-sfp-type={node.properties.type} data-source-name={node.properties.name} className="case-captured-node case-email-control" type="email" name="email" autoComplete="email" inputMode="email" aria-label={label} value={value} onChange={event => onChange(event.target.value)} style={{ ...style, ...textStyle(position, facts), left: -position.x, top: -position.y, textIndent: position.x }} />
    <span style={{ opacity: value ? 0 : 1 }}><CapturedText node={placeholder} facts={facts} /></span>
  </label></div>;
}
