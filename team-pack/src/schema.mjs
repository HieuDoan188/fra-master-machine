// Minimal JSON Schema (2020-12 subset) validator for contracts/progress-event.schema.json.
// Supports: $ref (local), oneOf, type, const, enum, required, properties,
// additionalProperties:false, pattern, minLength, maxLength, minimum, maximum, maxItems, items.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadProgressSchema() {
  return JSON.parse(readFileSync(join(here, '..', 'contracts', 'progress-event.schema.json'), 'utf8'));
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((node, key) => node[key], root);
}

const regexCache = new Map();
function regex(p) {
  if (!regexCache.has(p)) regexCache.set(p, new RegExp(p, 'u'));
  return regexCache.get(p);
}

export function validate(root, schema, value, path = '$') {
  if (schema.$ref) return validate(root, resolveRef(root, schema.$ref), value, path);
  const errors = [];
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(root, s, value, path).length === 0);
    if (passing.length !== 1) errors.push(`${path}: matches ${passing.length} oneOf branches (need exactly 1)`);
    return errors;
  }
  const t = typeOf(value);
  if (schema.type) {
    const ok = schema.type === t || (schema.type === 'number' && (t === 'integer' || t === 'number'));
    if (!ok) return [`${path}: expected ${schema.type}, got ${t}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join('|')}`);
  if (t === 'string') {
    if (schema.minLength != null && [...value].length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.maxLength != null && [...value].length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.pattern && !regex(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (t === 'integer' || t === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (t === 'array') {
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(root, schema.items, v, `${path}[${i}]`)));
  }
  if (t === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validate(root, props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

export function validateProgressEvent(schema, event) {
  // Pick the branch by type for readable errors, then confirm oneOf as a whole.
  const branch = schema.oneOf.find((b) => b.properties?.type?.const === event?.type);
  if (!branch) return [`unknown event type ${JSON.stringify(event?.type)}`];
  const errors = validate(schema, branch, event);
  if (errors.length) return errors;
  return validate(schema, schema, event);
}
