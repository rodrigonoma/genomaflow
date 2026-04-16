'use strict';

/**
 * Recursively extract field paths from a JSON Schema object.
 * Returns flat list like ['nome_completo', 'dt_nascimento', 'laudo.arquivo_url']
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
    } else {
      fields.push(path);
    }
  }
  return fields;
}

/**
 * Fetch and parse a Swagger/OpenAPI URL.
 * Returns: { fields: string[], rawSchema: object }
 * Throws on network error or non-JSON response.
 */
async function fetchAndParseSwagger(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Failed to fetch swagger: ${res.status} ${res.statusText}`);

  let spec;
  try {
    spec = await res.json();
  } catch {
    throw new Error('Swagger URL did not return valid JSON');
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
 */
function resolveFieldMap(fieldMap, payload) {
  const result = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) {
    const parts = sourcePath.replace(/^\$\.?/, '').split('.');
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
