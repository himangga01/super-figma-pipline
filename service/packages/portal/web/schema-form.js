const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.hasOwn(value ?? {}, key);
export const MAX_SCHEMA_JSON_BYTES = 12 * 1024 * 1024;
export function readBoundedSchemaJson(text, path = '입력') {
  if (new TextEncoder().encode(text).byteLength > MAX_SCHEMA_JSON_BYTES)
    throw new Error(`${path}: JSON 입력은 UTF-8 기준 12 MiB 이하여야 합니다.`);
  return JSON.parse(text);
}
const branches = schema =>
  schema.anyOf ??
  schema.oneOf ??
  (Array.isArray(schema.type) ? schema.type.map(type => ({ ...schema, type })) : null);
const valueType = value =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const fieldLabels = {
  nodeId: '노드 ID',
  nodeIds: '노드 ID 목록',
  workspaceId: '작업 공간 ID',
  targetPath: '결과 상대 폴더',
  name: '이름',
  value: '값',
  text: '문구',
  description: '설명',
  url: '주소',
  fileKey: 'Figma 파일 키',
  x: '가로 위치',
  y: '세로 위치',
  width: '너비',
  height: '높이',
  visible: '표시',
  opacity: '불투명도',
  color: '색상',
  args: '입력',
  type: '유형',
  source: '수집 경로',
  collector: 'Chrome 수집 방식',
  references: '참조 목록',
  requirements: '요구사항',
  case: '작업 유형',
};
const typeLabels = {
  string: '문자',
  number: '숫자',
  integer: '정수',
  boolean: '참·거짓',
  null: '값 없음',
  object: '항목 묶음',
  array: '목록',
};

export function schemaAlternativeLabel(schema) {
  if (own(schema, 'const')) return schema.const === null ? '값 없음' : String(schema.const);
  if (schema.title) return schema.title;
  const tag = Object.entries(schema.properties ?? {}).find(([, value]) => own(value, 'const'));
  return tag
    ? `${fieldLabels[tag[0]] ?? tag[0]}: ${String(tag[1].const)}`
    : (typeLabels[schema.type] ?? '복합 입력');
}

export function schemaAlternatives(schema) {
  const options = branches(schema);
  return options ? options.flatMap(option => schemaAlternatives(option)) : [schema];
}

export function coerceSchemaScalar(schema, text) {
  if (schema.type === 'null') return null;
  if (schema.type === 'boolean') {
    if (typeof text !== 'boolean') throw new Error('참 또는 거짓을 선택하세요.');
    return text;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof text !== 'string' || !text.trim()) throw new Error('숫자를 입력하세요.');
    const value = Number(text);
    if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)))
      throw new Error('유효한 숫자를 입력하세요.');
    return value;
  }
  return String(text);
}

/** Local field feedback only; the daemon remains the authoritative complete schema validator. */
export function checkSchemaValue(schema, value, path = '입력', depth = 0) {
  if (depth > 24) throw new Error(`${path}: 입력 중첩 한도를 초과했습니다.`);
  const alternatives = branches(schema);
  if (alternatives) {
    const matches = alternatives.filter(option => {
      try {
        checkSchemaValue(option, value, path, depth + 1);
        return true;
      } catch {
        return false;
      }
    });
    if (!matches.length || (schema.oneOf && matches.length !== 1))
      throw new Error(`${path}: 선택한 입력 유형에 맞지 않습니다.`);
    return value;
  }
  if (own(schema, 'const') && JSON.stringify(value) !== JSON.stringify(schema.const))
    throw new Error(`${path}: 지정된 값을 선택하세요.`);
  if (schema.enum && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value)))
    throw new Error(`${path}: 제공된 선택지에서 고르세요.`);
  const type = schema.type;
  if (
    type &&
    !(type === 'integer'
      ? typeof value === 'number' && Number.isInteger(value)
      : type === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : valueType(value) === type)
  )
    throw new Error(`${path}: ${type} 유형이 필요합니다.`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      throw new Error(`${path}: ${schema.minLength}자 이상 입력하세요.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      throw new Error(`${path}: ${schema.maxLength}자 이하로 입력하세요.`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      throw new Error(`${path}: 입력 형식을 확인하세요.`);
  }
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) ||
      (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
    )
      throw new Error(`${path}: 허용된 숫자 범위를 확인하세요.`);
  }
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      throw new Error(`${path}: 목록 개수를 확인하세요.`);
    if (
      schema.uniqueItems &&
      new Set(value.map(item => JSON.stringify(item))).size !== value.length
    )
      throw new Error(`${path}: 중복 항목을 제거하세요.`);
    if (schema.items && !Array.isArray(schema.items))
      value.forEach((item, index) =>
        checkSchemaValue(schema.items, item, `${path}[${index + 1}]`, depth + 1),
      );
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? [])
      if (!own(value, key)) throw new Error(`${path}.${key}: 필수 항목입니다.`);
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`${path}: 허용되지 않는 항목 이름입니다.`);
      if (schema.propertyNames)
        checkSchemaValue(schema.propertyNames, key, `${path}: 항목 이름`, depth + 1);
      if (own(schema.properties, key))
        checkSchemaValue(schema.properties[key], item, `${path}.${key}`, depth + 1);
      else if (schema.additionalProperties === false)
        throw new Error(`${path}.${key}: 등록되지 않은 항목입니다.`);
      else if (typeof schema.additionalProperties === 'object')
        checkSchemaValue(schema.additionalProperties, item, `${path}.${key}`, depth + 1);
    }
  }
  return value;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
const button = (text, handler) => {
  const element = node('button', text);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
};

/** Render ordinary schema fields without executing schema code or importing external resources. */
export function mountSchemaForm(
  container,
  schema,
  {
    value,
    workspaces = [],
    allowUnavailableWorkspaces = false,
    onChange = () => {},
    onError = () => {},
  } = {},
) {
  let controlCount = 0;
  const render = (parent, definition, initial, path, depth = 0) => {
    if (++controlCount > 4000 || depth > 24)
      throw new Error('입력 폼의 크기 또는 중첩 한도를 초과했습니다.');
    if (initial === undefined && own(definition, 'default'))
      initial = structuredClone(definition.default);
    const options = schemaAlternatives(definition);
    if (options.length > 1 && options.every(option => own(option, 'const'))) {
      return render(
        parent,
        {
          ...definition,
          anyOf: undefined,
          oneOf: undefined,
          enum: options.map(option => option.const),
        },
        initial,
        path,
        depth + 1,
      );
    }
    if (branches(definition)) {
      const choice = node('select'),
        content = node('div', undefined, 'schema-branch');
      choice.setAttribute('aria-label', `${path} 입력 유형`);
      for (const [index, option] of options.entries()) {
        const label = schemaAlternativeLabel(option);
        const entry = node('option', `${index + 1}. ${label}`);
        entry.value = String(index);
        choice.append(entry);
      }
      const selected = options.findIndex(option => {
        try {
          if (initial === undefined) return false;
          checkSchemaValue(option, initial);
          return true;
        } catch {
          return false;
        }
      });
      choice.value = String(Math.max(0, selected));
      parent.append(choice, content);
      let read;
      const draw = seed => {
        content.replaceChildren();
        read = render(content, options[Number(choice.value)], seed, path, depth + 1);
      };
      draw(initial);
      choice.addEventListener('change', () => {
        draw(undefined);
        onChange();
      });
      return () => read();
    }
    const actual =
      initial === undefined && own(definition, 'default')
        ? structuredClone(definition.default)
        : initial;
    if (own(definition, 'const') || definition.enum) {
      const values = definition.enum ?? [definition.const],
        choice = node('select');
      choice.setAttribute('aria-label', path);
      values.forEach((item, index) => {
        const entry = node('option', item === null ? '없음 (null)' : String(item));
        entry.value = String(index);
        choice.append(entry);
      });
      const selected = values.findIndex(item => JSON.stringify(item) === JSON.stringify(actual));
      if (selected >= 0) choice.value = String(selected);
      choice.addEventListener('change', onChange);
      parent.append(choice);
      return () => structuredClone(values[Number(choice.value)]);
    }
    if (definition.type === 'object' || definition.properties) {
      const getters = [];
      for (const [key, property] of Object.entries(definition.properties ?? {})) {
        if (forbiddenKeys.has(key))
          throw new Error('등록 스키마에 허용되지 않는 항목 이름이 있습니다.');
        const group = node('fieldset', undefined, 'schema-field'),
          legend = node('legend', `${fieldLabels[key] ?? key} (${key})`),
          holder = node('div');
        group.dataset.schemaField = key;
        group.dataset.schemaPath = `${path}.${key}`;
        group.append(legend);
        if (property.description) group.append(node('p', property.description, 'tiny muted'));
        const required = definition.required?.includes(key),
          present = own(actual, key);
        let include;
        if (!required) {
          const label = node('label', undefined, 'schema-optional');
          include = node('input');
          include.type = 'checkbox';
          include.checked = present;
          label.append(include, document.createTextNode('이 선택 항목을 포함'));
          group.append(label);
        } else group.append(node('span', '필수', 'tiny'));
        group.append(holder);
        parent.append(group);
        let getter;
        const draw = () => {
          holder.replaceChildren();
          if (required || include.checked)
            getter = render(
              holder,
              property,
              present ? actual[key] : undefined,
              `${path}.${key}`,
              depth + 1,
            );
        };
        draw();
        include?.addEventListener('change', () => {
          draw();
          onChange();
        });
        getters.push(() => (required || include.checked ? [key, getter()] : null));
      }
      const extra = definition.additionalProperties;
      if (extra !== false && (extra || !definition.properties)) {
        const list = node('div', undefined, 'schema-dictionary'),
          rows = [];
        parent.append(list);
        const add = (key = '', seed) => {
          const row = node('fieldset', undefined, 'schema-field'),
            name = node('input'),
            content = node('div');
          name.value = key;
          name.placeholder = '항목 이름';
          name.setAttribute('aria-label', `${path} 항목 이름`);
          const getter = render(
            content,
            typeof extra === 'object' ? extra : {},
            seed,
            `${path}.추가 항목`,
            depth + 1,
          );
          const entry = { row, name, getter };
          rows.push(entry);
          row.append(
            name,
            content,
            button('항목 삭제', () => {
              rows.splice(rows.indexOf(entry), 1);
              row.remove();
              onChange();
            }),
          );
          list.append(row);
          name.addEventListener('input', onChange);
        };
        for (const [key, item] of Object.entries(actual ?? {}))
          if (!own(definition.properties, key)) add(key, item);
        parent.append(
          button('이름 있는 항목 추가', () => {
            try {
              add();
              onChange();
            } catch (error) {
              onError(error);
            }
          }),
        );
        getters.push(() => {
          const seen = new Set();
          return {
            entries: rows.map(({ name, getter }) => {
              const key = name.value.trim();
              if (
                !key ||
                forbiddenKeys.has(key) ||
                own(definition.properties, key) ||
                seen.has(key)
              )
                throw new Error(`${path}: 고유한 항목 이름을 입력하세요.`);
              seen.add(key);
              return [key, getter()];
            }),
          };
        });
      }
      return () =>
        Object.fromEntries(
          getters.flatMap(getter => {
            const item = getter();
            return item === null ? [] : own(item, 'entries') ? item.entries : [item];
          }),
        );
    }
    if (definition.type === 'array') {
      const list = node('div', undefined, 'schema-array'),
        rows = [];
      parent.append(list);
      const add = seed => {
        if (rows.length >= Math.min(definition.maxItems ?? 1000, 1000))
          throw new Error(`${path}: 목록 개수 한도에 도달했습니다.`);
        const row = node('fieldset', undefined, 'schema-field'),
          legend = node('legend', `항목 ${rows.length + 1}`),
          content = node('div');
        const getter = render(
            content,
            definition.items ?? {},
            seed,
            `${path}[${rows.length + 1}]`,
            depth + 1,
          ),
          entry = { row, getter };
        rows.push(entry);
        row.append(
          legend,
          content,
          button('목록에서 삭제', () => {
            rows.splice(rows.indexOf(entry), 1);
            row.remove();
            onChange();
          }),
        );
        list.append(row);
      };
      for (const item of actual ?? []) add(item);
      parent.append(
        button('목록 항목 추가', () => {
          try {
            add(undefined);
            onChange();
          } catch (error) {
            onError(error);
          }
        }),
      );
      return () => rows.map(entry => entry.getter());
    }
    if (['string', 'number', 'integer', 'boolean', 'null'].includes(definition.type)) {
      if (definition.type === 'null') {
        parent.append(node('p', '값 없음 (null)'));
        return () => null;
      }
      if (definition.type === 'string' && path.endsWith('.workspaceId') && workspaces.length) {
        const select = node('select');
        select.setAttribute('aria-label', path);
        const empty = node('option', '등록된 작업 공간 선택');
        empty.value = '';
        select.append(empty);
        for (const space of workspaces) {
          const option = node(
            'option',
            `${space.realPath}${space.availability && space.availability !== 'available' ? ' (사용 상태 확인 필요)' : ''}`,
          );
          option.value = space.workspaceId;
          option.disabled =
            !allowUnavailableWorkspaces &&
            Boolean(space.availability && space.availability !== 'available');
          select.append(option);
        }
        if (actual !== undefined) select.value = actual;
        select.addEventListener('change', onChange);
        parent.append(select);
        return () => select.value;
      }
      const input = node(definition.type === 'string' ? 'textarea' : 'input');
      input.setAttribute('aria-label', path);
      if (definition.type === 'boolean') {
        input.type = 'checkbox';
        input.checked = actual === true;
      } else {
        input.value = actual === undefined ? '' : String(actual);
        if (definition.type === 'string' && definition.maxLength)
          input.maxLength = definition.maxLength;
        if (input.tagName === 'INPUT')
          input.type = ['number', 'integer'].includes(definition.type) ? 'number' : 'text';
        if (input.type === 'number') input.step = definition.type === 'integer' ? '1' : 'any';
      }
      parent.append(input);
      if (definition.type === 'string') {
        input.rows = (definition.maxLength ?? 257) > 256 ? 4 : 1;
        let original = actual === undefined ? '' : String(actual),
          edited = false;
        const ordinary = () =>
          !edited && input.value === original.replace(/\r\n?/gu, '\n') ? original : input.value;
        input.addEventListener('input', () => {
          edited = true;
          onChange();
        });
        const disclosure = node('details'),
          exact = node('input'),
          raw = node('textarea'),
          label = node('label');
        exact.type = 'checkbox';
        exact.setAttribute('aria-label', `${path} 문자열 원문 JSON 사용`);
        raw.setAttribute('aria-label', `${path} 문자열 원문 JSON`);
        raw.rows = 4;
        raw.disabled = true;
        const parseExact = () => {
          const exactValue = readBoundedSchemaJson(raw.value, path);
          if (typeof exactValue !== 'string') throw new Error(`${path}: JSON 문자열을 입력하세요.`);
          return exactValue;
        };
        label.append(exact, document.createTextNode('문자열 원문 JSON 사용'));
        disclosure.append(
          node('summary', '고급: 정확한 문자열 원문'),
          node(
            'p',
            '일반 입력을 편집하면 브라우저가 줄바꿈을 LF로 처리합니다. CRLF, CR 등 정확한 원문이 필요하면 JSON 문자열의 이스케이프를 사용하세요.',
            'tiny muted',
          ),
          label,
          raw,
        );
        parent.append(disclosure);
        exact.addEventListener('change', () => {
          try {
            if (exact.checked) raw.value = JSON.stringify(ordinary());
            else {
              original = parseExact();
              input.value = original;
              edited = false;
            }
          } catch (error) {
            exact.checked = true;
            onError(error);
          }
          input.disabled = exact.checked;
          raw.disabled = !exact.checked;
          onChange();
        });
        raw.addEventListener('input', onChange);
        return () => (exact.checked ? parseExact() : ordinary());
      }
      input.addEventListener('input', onChange);
      return () =>
        coerceSchemaScalar(definition, definition.type === 'boolean' ? input.checked : input.value);
    }
    const disclosure = node('details'),
      summary = node('summary', '고급: 복합 입력 JSON'),
      input = node('textarea');
    input.value = actual === undefined ? '' : JSON.stringify(actual, null, 2);
    input.setAttribute('aria-label', `${path} 고급 JSON`);
    disclosure.append(
      summary,
      node(
        'p',
        '이 항목은 일반 형식이 없는 복합 스키마입니다. 서비스가 전체 스키마를 다시 검증합니다.',
        'tiny muted',
      ),
      input,
    );
    parent.append(disclosure);
    input.addEventListener('input', onChange);
    return () => {
      if (!input.value.trim()) throw new Error(`${path}: 복합 입력을 작성하세요.`);
      return readBoundedSchemaJson(input.value, path);
    };
  };
  const common = node('div'),
    bulk = node('details'),
    enabled = node('input'),
    input = node('textarea'),
    label = node('label');
  enabled.type = 'checkbox';
  enabled.setAttribute('aria-label', '입력 전체 JSON 사용');
  input.setAttribute('aria-label', '입력 전체 JSON');
  input.rows = 10;
  input.disabled = true;
  input.value = value === undefined ? '' : JSON.stringify(value, null, 2);
  label.append(enabled, document.createTextNode('전체 입력 JSON 사용'));
  bulk.append(
    node('summary', '고급: 전체 입력 JSON'),
    node(
      'p',
      '큰 목록이나 복합 입력은 전체 JSON으로 작성할 수 있습니다. 일반 폼의 항목 수 한도를 우회해도 스키마 검증은 유지됩니다. UTF-8 12 MiB 한도이며 최종 요청 전체도 서버의 같은 크기 한도를 따릅니다. 입력을 잘라서 보내지 않습니다.',
      'tiny muted',
    ),
    label,
    input,
  );
  container.replaceChildren(bulk, common);
  let getter;
  const draw = seed => {
    controlCount = 0;
    common.replaceChildren();
    getter = render(common, schema, seed, '입력');
  };
  const state = () => {
    common.hidden = enabled.checked;
    input.disabled = !enabled.checked;
  };
  try {
    draw(value);
  } catch (error) {
    common.replaceChildren();
    enabled.checked = true;
    bulk.open = true;
    bulk.append(
      node(
        'p',
        `일반 폼을 표시할 수 없습니다. 전체 JSON 입력을 사용하세요: ${error.message}`,
        'tiny muted',
      ),
    );
    state();
  }
  enabled.addEventListener('change', () => {
    try {
      if (enabled.checked) {
        try {
          input.value = JSON.stringify(getter(), null, 2);
        } catch {
          /* Retain explicit JSON when ordinary fields are incomplete. */
        }
      } else draw(checkSchemaValue(schema, readBoundedSchemaJson(input.value)));
    } catch (error) {
      enabled.checked = true;
      onError(error);
    }
    state();
    onChange();
  });
  input.addEventListener('input', onChange);
  return {
    read: () =>
      checkSchemaValue(schema, enabled.checked ? readBoundedSchemaJson(input.value) : getter()),
    clear: () => container.replaceChildren(),
  };
}
