'use strict';

/**
 * Validate that a URL is safe to fetch (not SSRF-vulnerable).
 * Throws if URL is invalid, non-http/https, or points to a private address.
 */
function assertSafeUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('url must be a non-empty string');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol))
    throw new Error('Only http/https URLs are permitted');
  const host = parsed.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
    throw new Error('Private/loopback addresses are not permitted');
}

/**
 * Recursively extract field paths from a JSON Schema object.
 * Returns flat list like ['nome_completo', 'dt_nascimento', 'address.city']
 *
 * NOTE: $ref, allOf, oneOf, anyOf are NOT resolved. Caller must pre-resolve
 * the spec if those constructs are present.
 */
function extractFields(schema, prefix = '') {
  const fields = [];
  if (!schema || schema.type !== 'object' || !schema.properties) {
    if (prefix) fields.push(prefix);
    return fields;
  }
  for (const [key, val] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val.type === 'object' && val.properties) {
      fields.push(...extractFields(val, path));
    } else if (val.type === 'array' && val.items) {
      fields.push(...extractFields(val.items, path));
    } else {
      fields.push(path);
    }
  }
  return fields;
}

/**
 * Fetch and parse a Swagger/OpenAPI URL.
 * Returns: { fields: string[], rawSchema: object }
 * Throws on invalid URL, SSRF-risk address, network error, or non-OpenAPI response.
 */
async function fetchAndParseSwagger(url) {
  assertSafeUrl(url);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Failed to fetch swagger: ${res.status} ${res.statusText}`);

  let spec;
  try {
    spec = await res.json();
  } catch {
    throw new Error('Swagger URL did not return valid JSON');
  }

  if (!spec.openapi && !spec.swagger) {
    throw new Error('URL does not appear to be a valid OpenAPI/Swagger document');
  }

  const schemas = {};

  // OpenAPI 3.x
  if (spec.openapi && spec.components?.schemas) {
    Object.assign(schemas, spec.components.schemas);
  }
  // Swagger 2.x
  if (spec.swagger && spec.definitions) {
    Object.assign(schemas, spec.definitions);
  }

  const fields = new Set();
  for (const schema of Object.values(schemas)) {
    for (const f of extractFields(schema)) {
      fields.add(f);
    }
  }

  return { fields: Array.from(fields).sort(), rawSchema: spec };
}

/**
 * Given field_map (GenomaFlow key → source path like "$.paciente.nome"),
 * resolve actual values from a source payload.
 * Supports dot notation and array-index notation (e.g. "$.results[0].name").
 */
function resolveFieldMap(fieldMap, payload) {
  const result = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) {
    if (!sourcePath) { result[target] = null; continue; }
    // Normalize: strip leading $. then split on '.' and expand 'key[0]' into ['key', '0']
    const normalized = sourcePath.replace(/^\$\.?/, '');
    if (!normalized) { result[target] = null; continue; }
    const parts = normalized.split('.').flatMap(p => {
      const m = p.match(/^([^\[]+)(?:\[(\d+)\])?$/);
      return m ? (m[2] !== undefined ? [m[1], m[2]] : [m[1]]) : [p];
    });
    let val = payload;
    for (const p of parts) {
      val = val?.[p];
      if (val === undefined) break;
    }
    result[target] = val ?? null;
  }
  return result;
}

module.exports = { fetchAndParseSwagger, resolveFieldMap };
