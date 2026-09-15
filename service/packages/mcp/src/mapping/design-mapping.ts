import { canonicalJson } from '@sfp/ir';
import {
  DesignContextNodeSchema,
  DesignObservationSchema,
  GetVariableDefsResultSchema,
  SerializedPaintStyleSchema,
  type DesignContextNode,
  type DesignObservation,
  type GetDesignContextResult,
  type GetVariableDefsResult,
  type GetStylesResult,
} from '@sfp/shared';

import type { RepoSvg } from '../icons/repo-icons.js';
import { collectFigmaComponents, joinComponents, type JoinOptions } from '../join/component-map.js';
import { collectFigmaIcons, joinIcons, type IconJoinOptions } from '../join/icon-map.js';
import { joinTokens, type TokenJoinOptions } from '../join/token-map.js';
import { normalizeDesignObservation } from '../portal/design-normalization.js';
import type { ScannedComponent } from '../scan/scan.js';
import { resolveFigmaTokens, resolvePaintStyleTokens } from '../tokens/figma-tokens.js';
import type { ProjectToken } from '../tokens/tokens.js';

/** Catalog conflicts cannot provide a trustworthy node binding, even when a first row was retained. */
export const normalizeMappingObservation = (input: unknown): DesignObservation => {
  const observation = normalizeDesignObservation(input);
  const conflicted = observation.issues.some(
    issue =>
      issue.code === 'DUPLICATE_ID' &&
      ['variables/', 'collections/'].some(scope => issue.scope.startsWith(scope)),
  );
  if (!conflicted) return observation;
  return DesignObservationSchema.parse({
    ...observation,
    bindings: observation.bindings.map(binding => {
      const { value: _value, ...retained } = binding;
      return Object.assign({}, retained, { status: 'unresolved', reason: 'MALFORMED_VALUE' });
    }),
  });
};

type CatalogRow = { id: string; [key: string]: unknown };
/** Compare material fields, not absent library keys/descriptions or collection membership metadata. */
const materialValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(materialValue);
  if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    if ('r' in fields && 'g' in fields && 'b' in fields)
      return { r: fields.r, g: fields.g, b: fields.b, a: fields.a ?? 1 };
    return Object.fromEntries(
      Object.entries(fields).map(([key, item]) => [key, materialValue(item)]),
    );
  }
  return value;
};
const material = (row: CatalogRow, fields: readonly string[]) =>
  canonicalJson(
    Object.fromEntries(
      fields.map(field => {
        if (field === 'paints') {
          const parsed = SerializedPaintStyleSchema.safeParse({
            ...row,
            key: row.key ?? '',
            description: row.description ?? '',
          });
          return [field, parsed.success ? parsed.data.paints : row.paints];
        }
        if (field === 'valuesByMode') return [field, materialValue(row[field])];
        if (field === 'codeSyntax') return [field, row[field] ?? {}];
        if (field === 'modes' && Array.isArray(row[field]))
          return [
            field,
            row[field].toSorted((a, b) =>
              canonicalJson(a) < canonicalJson(b)
                ? -1
                : canonicalJson(a) > canonicalJson(b)
                  ? 1
                  : 0,
            ),
          ];
        return [field, row[field] ?? null];
      }),
    ),
  );
const mergeCatalog = (
  local: readonly CatalogRow[],
  referenced: readonly CatalogRow[],
  fields: readonly string[],
) => {
  const rows = [...local];
  const signatures = new Set(local.map(row => material(row, fields)));
  for (const row of referenced) {
    const signature = material(row, fields);
    if (!signatures.has(signature)) {
      rows.push(row);
      signatures.add(signature);
    }
  }
  return rows;
};

/** Reconstruct the same raw observation from a persisted or directly returned Desktop context. */
export const observeMappingContext = (
  context: GetDesignContextResult,
  local?: { variables: GetVariableDefsResult; styles: GetStylesResult },
): DesignObservation => {
  // eslint-disable-next-line oxc/no-map-spread -- retain immutable observed input
  const variables = Object.entries(context.variables ?? {}).map(([id, token]) => ({
    id,
    name: token.name,
    resolvedType: token.type,
    key: '',
    ...(token.collectionId === undefined ? {} : { collectionId: token.collectionId }),
    ...(token.valuesByMode === undefined ? {} : { valuesByMode: token.valuesByMode }),
    ...(token.codeSyntax ? { codeSyntax: token.codeSyntax } : {}),
  }));
  const collections = Object.values(context.variables ?? {}).flatMap(token =>
    token.collection ? [token.collection] : [],
  );
  // Repeated references to one identical observed collection are the same catalog record.
  // Conflicting same-ID records remain separate and normalization reports them incomplete.
  const unique = [
    ...new Map(collections.map(collection => [canonicalJson(collection), collection])).values(),
  ];
  const paints = Object.entries(context.styles ?? {}).flatMap(([id, style]) =>
    style.paints
      ? [
          {
            id,
            name: style.name,
            key: '',
            description: '',
            paints: style.paints,
          },
        ]
      : [],
  );
  return normalizeMappingObservation({
    source: 'desktop-plugin',
    document: context,
    variables: {
      variables: mergeCatalog(local?.variables.variables ?? [], variables, [
        'id',
        'name',
        'resolvedType',
        'collectionId',
        'valuesByMode',
        'codeSyntax',
      ]),
      collections: mergeCatalog(local?.variables.collections ?? [], unique, [
        'id',
        'name',
        'defaultModeId',
        'modes',
      ]),
    },
    styles: {
      ...local?.styles,
      paints: mergeCatalog(local?.styles.paints ?? [], paints, ['id', 'name', 'paints']),
    },
  });
};

export const observationVariableDefs = (observation: DesignObservation) =>
  GetVariableDefsResultSchema.parse({
    collections: observation.catalogs.collections.map(({ id, raw }) => ({
      ...raw,
      id,
      key: raw.key ?? '',
      variableIds: observation.catalogs.variables
        .filter(variable => variable.collectionId === id)
        .map(variable => variable.id),
    })),
    variables: observation.catalogs.variables.map(variable => ({
      ...variable.raw,
      id: variable.id,
      key: variable.raw.key ?? '',
      collectionId: variable.collectionId,
      valuesByMode: Object.fromEntries(
        Object.entries(variable.valuesByMode).map(([mode, value]) => [
          mode,
          value && typeof value === 'object' && !Array.isArray(value) && 'r' in value
            ? { a: 1, ...value }
            : value,
        ]),
      ),
    })),
  });

/** Preserve full normalized node evidence separately from the legacy join's supported projection. */
export const observationMappingNodes = (observation: DesignObservation): DesignContextNode[] => {
  const byId = new Map(observation.nodes.map(node => [node.id, node]));
  const project = (id: string): DesignContextNode => {
    const node = byId.get(id)!;
    const fields = Object.fromEntries(
      [
        'id',
        'name',
        'type',
        'x',
        'y',
        'width',
        'height',
        'mainComponent',
        'mainComponentId',
        'componentProperties',
        'componentApi',
        'variantProperties',
        'textOverrides',
        'propertyOverrides',
        'boundVariables',
        'styleIds',
        'fills',
        'strokes',
        'explicitVariableModes',
        'resolvedVariableModes',
      ].flatMap(key =>
        node.properties[key] === undefined || node.properties[key] === null
          ? []
          : [[key, node.properties[key]]],
      ),
    );
    if (
      fields.boundVariables &&
      typeof fields.boundVariables === 'object' &&
      !Array.isArray(fields.boundVariables)
    ) {
      fields.boundVariables = Object.fromEntries(
        Object.entries(fields.boundVariables).map(([key, value]) => [
          key,
          (Array.isArray(value) ? value : [value]).flatMap(binding =>
            typeof binding === 'string'
              ? [binding]
              : binding &&
                  typeof binding === 'object' &&
                  !Array.isArray(binding) &&
                  typeof binding.id === 'string'
                ? [binding.id]
                : [],
          ),
        ]),
      );
    }
    return DesignContextNodeSchema.parse({
      ...fields,
      id: node.id,
      children: node.childIds.map(project),
    });
  };
  return observation.roots.map(project);
};
const invalidate = (token: ReturnType<typeof resolveFigmaTokens>[number]) => ({
  ...token,
  value: null,
  resolution: 'unresolved' as const,
  ...(token.modeValues
    ? { modeValues: Object.fromEntries(Object.keys(token.modeValues).map(mode => [mode, null])) }
    : {}),
});

export const mapObservationTokens = (
  observation: DesignObservation,
  project: readonly ProjectToken[],
  options: TokenJoinOptions,
) => {
  const paints = observation.catalogs.paintStyles.flatMap(style => {
    const result = SerializedPaintStyleSchema.safeParse({
      ...style,
      key: style.key ?? '',
      description: style.description ?? '',
    });
    return result.success ? [result.data] : [];
  });
  const variables = resolveFigmaTokens(observationVariableDefs(observation));
  const invalidCatalog = observation.issues.some(issue =>
    ['variables', 'collections'].some(
      scope => issue.scope === scope || issue.scope.startsWith(`${scope}/`),
    ),
  );
  const styleTokens = resolvePaintStyleTokens(paints);
  const invalidStyles = observation.issues.some(
    issue => issue.scope === 'paintStyles' || issue.scope.startsWith('paintStyles/'),
  );
  return joinTokens(
    [
      ...(invalidCatalog ? variables.map(invalidate) : variables),
      ...(invalidStyles ? styleTokens.map(invalidate) : styleTokens),
    ],
    project,
    options,
  );
};
export const mapObservationComponents = (
  observation: DesignObservation,
  scanned: readonly ScannedComponent[],
  options: JoinOptions,
) => {
  const nodes = new Map(observation.nodes.map(node => [node.id, node]));
  return joinComponents(
    collectFigmaComponents(observationMappingNodes(observation)),
    scanned,
    options,
  ).map(mapping =>
    Object.assign({}, mapping, {
      observations: mapping.instances.flatMap(instance => {
        const node = nodes.get(instance.nodeId);
        return node ? [{ nodeId: node.id, properties: node.properties }] : [];
      }),
    }),
  );
};
export const mapObservationIcons = (
  observation: DesignObservation,
  svgs: readonly RepoSvg[],
  options: IconJoinOptions,
) => joinIcons(collectFigmaIcons(observationMappingNodes(observation)), svgs, options);
