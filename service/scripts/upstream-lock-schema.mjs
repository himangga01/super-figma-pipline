// The upstream lock uses this bounded JSON Schema vocabulary. Unknown constraints fail closed.
const supported = new Set([
  '$schema',
  '$id',
  'title',
  '$defs',
  '$ref',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'unevaluatedProperties',
  'const',
  'enum',
  'pattern',
  'minLength',
  'maxLength',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'allOf',
  'oneOf',
]);

export const validateLockSchema = (schema, value) => {
  const visit = (rule, data, path) => {
    for (const key of Object.keys(rule)) {
      if (!supported.has(key)) throw new Error(`Unsupported upstream schema keyword: ${key}`);
    }
    const errors = [];
    const evaluated = new Set();
    const reject = message => errors.push(`${path}: ${message}`);
    const merge = result => {
      errors.push(...result.errors);
      for (const property of result.evaluated) evaluated.add(property);
    };
    if (rule.$ref !== undefined) {
      if (!/^#\/\$defs\/[^/]+$/.test(rule.$ref))
        throw new Error('Unsupported upstream schema reference');
      const resolved = schema.$defs?.[rule.$ref.slice('#/$defs/'.length)];
      if (resolved === undefined)
        throw new Error(`Missing upstream schema reference: ${rule.$ref}`);
      merge(visit(resolved, data, path));
    }
    const object = data !== null && typeof data === 'object' && !Array.isArray(data);
    if (rule.type !== undefined) {
      const valid =
        rule.type === 'object'
          ? object
          : rule.type === 'array'
            ? Array.isArray(data)
            : rule.type === 'null'
              ? data === null
              : typeof data === rule.type;
      if (!valid) reject(`expected ${rule.type}`);
    }
    if ('const' in rule && data !== rule.const) reject('constant mismatch');
    if (rule.enum !== undefined && !rule.enum.includes(data)) reject('unknown enum value');
    if (typeof data === 'string') {
      const length = [...data].length;
      if (rule.pattern !== undefined && !new RegExp(rule.pattern, 'u').test(data))
        reject('pattern mismatch');
      if (rule.minLength !== undefined && length < rule.minLength) reject('string too short');
      if (rule.maxLength !== undefined && length > rule.maxLength) reject('string too long');
    }
    if (object) {
      for (const property of rule.required ?? [])
        if (!(property in data)) reject(`missing ${property}`);
      for (const [property, child] of Object.entries(rule.properties ?? {})) {
        if (property in data) {
          evaluated.add(property);
          merge(visit(child, data[property], `${path}.${property}`));
        }
      }
      if (rule.additionalProperties === false) {
        for (const property of Object.keys(data)) {
          if (!(property in (rule.properties ?? {}))) reject(`unknown ${property}`);
        }
      }
    }
    if (Array.isArray(data)) {
      if (rule.minItems !== undefined && data.length < rule.minItems) reject('array too short');
      if (rule.maxItems !== undefined && data.length > rule.maxItems) reject('array too long');
      if (rule.uniqueItems && new Set(data.map(item => JSON.stringify(item))).size !== data.length)
        reject('duplicate items');
      if (rule.items !== undefined)
        data.forEach((item, index) => merge(visit(rule.items, item, `${path}[${index}]`)));
    }
    for (const child of rule.allOf ?? []) merge(visit(child, data, path));
    if (rule.oneOf !== undefined) {
      const matches = rule.oneOf
        .map(child => visit(child, data, path))
        .filter(result => result.errors.length === 0);
      if (matches.length !== 1) reject('expected exactly one variant');
      else merge(matches[0]);
    }
    if (object && rule.unevaluatedProperties === false) {
      for (const property of Object.keys(data))
        if (!evaluated.has(property)) reject(`unevaluated ${property}`);
    }
    return { errors, evaluated };
  };
  return visit(schema, value, '$').errors;
};
