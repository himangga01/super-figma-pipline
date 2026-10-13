import type { CSSProperties, ReactNode } from 'react';

export type Color = { r: number; g: number; b: number; a?: number };
export type Paint = { type: string; visible?: boolean; color?: Color; opacity?: number; imageHash?: string; scaleMode?: string; gradientTransform?: number[][]; gradientStops?: { color: Color; position: number }[] };
export type TextProperties = {
  fontName?: { family: string; style: string }; fontSize?: number; fontWeight?: number;
  letterSpacing?: { unit: string; value: number }; lineHeight?: { unit: string; value: number };
  textAlignHorizontal?: string; textCase?: string; textDecoration?: string; fills?: Paint[];
};
export type NodeProperties = TextProperties & {
  id: string; type: string; name: string; width: number; height: number; x: number; y: number; visible?: boolean; opacity?: number;
  characters?: string; fills?: Paint[]; strokes?: Paint[]; strokeWeight?: number; clipsContent?: boolean;
  cornerRadius?: number; topLeftRadius?: number; topRightRadius?: number; bottomLeftRadius?: number; bottomRightRadius?: number;
  paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number; itemSpacing?: number;
  relativeTransform?: number[][]; absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  effects?: { type: string; visible?: boolean; offset: { x: number; y: number }; radius: number; spread?: number; color: Color }[];
  textSegments?: TextProperties[];
};
export type CapturedNode = { id: string; parentId: string | null; childIds: string[]; properties: NodeProperties };
export type Glyph = { resourceId: string; transform: number[]; index: number; strokeWidth?: number; commandsBlob?: string };
export type GlyphResource = { resourceId: string; d: string; commandsHash: string };
export type GeometryNode = { nodeId: string; width: number; height: number; nominalFontSize?: number; fonts?: { family: string; weight?: number }[]; paintedFontSizes?: number[]; glyphs: Glyph[]; paint: { fill: string; stroke?: string; filter?: string; opacity?: number; paintOrder?: CSSProperties['paintOrder'] } };
export type CapturedAsset = { id: string; path: string; sha256: string; bytes: number; query: { kind: 'image'; imageHash: string } | { kind: 'svg'; nodeId: string } };
export type CaseFacts = {
  schemaVersion: 1; nodes: CapturedNode[]; geometry: { nodes: GeometryNode[]; resources: GlyphResource[] }; assets: CapturedAsset[];
  binding: { caseId: 'c2' | 'c3'; planId: string; contextHash: string; coreResultId: string; captureId: string; documentHash: string };
  views: Record<string, { rootId: string; width: number; contentHeight: number }>;
};
export type IndexedFacts = CaseFacts & {
  nodeIndex: Record<string, CapturedNode>; geometryIndex: Record<string, GeometryNode>; resourceIndex: Record<string, GlyphResource>;
  imageAssets: Record<string, CapturedAsset>; vectorAssets: Record<string, CapturedAsset>;
};
export type ControlRenderer = (input: { node: CapturedNode; style: CSSProperties; children: ReactNode }) => ReactNode | undefined;
