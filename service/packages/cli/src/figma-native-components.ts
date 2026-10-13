import { nativeNodeId } from './figma-native-document.js';

type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

export const NATIVE_COMPONENT_FIELDS = [
  'componentProperties',
  'variantProperties',
  'mainComponent',
  'componentApi',
  'componentPropertyDefinitions',
  'description',
] as const;

/** Decode component identities and variant assignments from native records only. */
export function nativeComponentProperties(node: Row, type: string, byId: Map<string, Row>) {
  const values: Row = {};
  const unknown: string[] = [];
  if (!['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(type)) return { values, unknown };
  if (type !== 'INSTANCE') {
    if (node.symbolDescription === undefined || typeof node.symbolDescription === 'string')
      values.description = node.symbolDescription ?? '';
    else unknown.push('description');
  }
  const componentId =
    type === 'INSTANCE'
      ? (nativeNodeId(node.overriddenSymbolID) ?? nativeNodeId(object(node.symbolData).symbolID))
      : nativeNodeId(node.guid);
  const component = type === 'INSTANCE' ? byId.get(componentId ?? '') : node;
  const parent = component && byId.get(nativeNodeId(object(component.parentIndex).guid) ?? '');
  const set = parent?.isStateGroup === true ? parent : undefined;
  const owner = set ?? component;
  const definitions = owner?.componentPropDefs;
  const emptyDefinitions =
    owner !== undefined &&
    (definitions === undefined || (Array.isArray(definitions) && definitions.length === 0));

  if (type === 'INSTANCE') {
    if (component && typeof component.name === 'string' && componentId) {
      const identity = {
        id: componentId,
        name: component.name,
        ...(set ? { componentSetId: nativeNodeId(set.guid), componentSetName: set.name } : {}),
      };
      // Local native records do not carry the Plugin API key. Keep these partial facts separately.
      values.nativeMainComponent = identity;
      if (
        typeof component.componentKey === 'string' &&
        /^[0-9a-f]{40}$/u.test(component.componentKey) &&
        typeof component.sourceLibraryKey === 'string'
      )
        values.mainComponent = { ...identity, key: component.componentKey, remote: true };
      else unknown.push('mainComponent');
    } else unknown.push('mainComponent');
    if (emptyDefinitions)
      values.componentApi = { ownerId: nativeNodeId(owner!.guid), definitions: {} };
    else unknown.push('componentApi');
  } else {
    // Variant default values are not established by child order or display names.
    if (emptyDefinitions) values.componentPropertyDefinitions = {};
    else unknown.push('componentPropertyDefinitions');
  }

  let variants: Row | null | undefined;
  if (type !== 'COMPONENT_SET' && component) {
    if (!set && component.variantPropSpecs === undefined) variants = null;
    else if (set && Array.isArray(definitions) && Array.isArray(component.variantPropSpecs)) {
      const names = new Map<string, string>();
      let valid = definitions.length <= 1024;
      for (const input of definitions.length <= 1024 ? definitions : []) {
        const definition = object(input);
        const id = nativeNodeId(definition.id);
        if (
          !id ||
          definition.type !== 'VARIANT' ||
          typeof definition.name !== 'string' ||
          !definition.name ||
          names.has(id) ||
          [...names.values()].includes(definition.name)
        ) {
          valid = false;
          break;
        }
        names.set(id, definition.name);
      }
      const assigned: Row = Object.create(null);
      if (component.variantPropSpecs.length > 1024) valid = false;
      else
        for (const input of component.variantPropSpecs) {
          const spec = object(input),
            name = names.get(nativeNodeId(spec.propDefId) ?? '');
          if (!name || typeof spec.value !== 'string' || Object.hasOwn(assigned, name)) {
            valid = false;
            break;
          }
          assigned[name] = spec.value;
        }
      if (valid && Object.keys(assigned).length === names.size) variants = assigned;
    }
    if (variants === undefined) unknown.push('variantProperties');
    else values.variantProperties = variants;
  } else if (type !== 'COMPONENT_SET') unknown.push('variantProperties');

  if (type === 'INSTANCE') {
    if (node.componentPropAssignments !== undefined || node.componentPropRefs !== undefined)
      unknown.push('componentProperties');
    else if (variants !== undefined && (variants !== null || emptyDefinitions))
      values.componentProperties = Object.fromEntries(
        Object.entries(variants ?? {}).map(([name, value]) => [
          name,
          { type: 'VARIANT', value, boundVariables: {} },
        ]),
      );
    else unknown.push('componentProperties');
  }
  return { values, unknown };
}
