#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const API_DOCS = Object.freeze([
  { spec: 'docs/api/dashboard.openapi.json', markdown: 'docs/api/dashboard.md' },
  { spec: 'docs/api/cloud.openapi.json', markdown: 'docs/api/cloud.md' },
]);
export const HTTP_METHODS = Object.freeze(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const USAGE = `Usage: node tools/generate-api-docs.mjs [--check]

Validates the OpenAPI specs in docs/api/ and renders them to Markdown.
--check exits 1 when a committed Markdown file is missing or stale.`;

export function operations(spec) {
  const result = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) if (item?.[method]) result.push({ path, method, operation: item[method], pathItem: item });
  }
  return result;
}

export function resolvePointer(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = spec;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

function collectRefs(node, found = []) {
  if (Array.isArray(node)) node.forEach(child => collectRefs(child, found));
  else if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') found.push(node.$ref);
    Object.values(node).forEach(child => collectRefs(child, found));
  }
  return found;
}

function identityErrors(operation, seenIds) {
  const errors = [];
  if (!operation.operationId) errors.push('missing operationId');
  else if (seenIds.has(operation.operationId)) errors.push(`duplicate operationId ${operation.operationId}`);
  seenIds.add(operation.operationId);
  if (!operation.summary) errors.push('missing summary');
  return errors;
}

function responseErrors(operation) {
  const statuses = Object.keys(operation.responses || {});
  if (!statuses.length) return ['no responses'];
  return statuses.flatMap(status => [
    ...(/^([1-5]\d\d|[1-5]XX|default)$/.test(status) ? [] : [`invalid response key ${status}`]),
    ...(operation.responses[status]?.description ? [] : [`response ${status} has no description`]),
  ]);
}

function pathParameterErrors(path, operation, pathItem) {
  const declared = new Set([...(pathItem.parameters || []), ...(operation.parameters || [])].filter(p => p.in === 'path').map(p => p.name));
  const templated = new Set([...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]));
  return [
    ...[...templated].filter(name => !declared.has(name)).map(name => `path parameter {${name}} is not declared`),
    ...[...declared].filter(name => !templated.has(name)).map(name => `declared path parameter ${name} is not in the path`),
  ];
}

function securityErrors(spec, operation) {
  const schemes = spec.components?.securitySchemes || {};
  return (operation.security || spec.security || [])
    .flatMap(Object.keys)
    .filter(scheme => !schemes[scheme])
    .map(scheme => `unknown security scheme ${scheme}`);
}

function operationErrors(spec, { path, method, operation, pathItem }, seenIds) {
  const label = `${method.toUpperCase()} ${path}`;
  return [
    ...identityErrors(operation, seenIds),
    ...responseErrors(operation),
    ...pathParameterErrors(path, operation, pathItem),
    ...securityErrors(spec, operation),
  ].map(error => `${label}: ${error}`);
}

function documentErrors(spec) {
  const errors = [];
  if (!/^3\.1\.\d+$/.test(String(spec?.openapi))) errors.push(`openapi must be 3.1.x, found ${spec?.openapi}`);
  const info = spec?.info || {};
  if (!info.title || !info.version) errors.push('info.title and info.version are required');
  return errors;
}

export function validateOpenApi(spec) {
  const errors = documentErrors(spec);
  if (!spec?.paths || typeof spec.paths !== 'object') return [...errors, 'paths object is required'];
  for (const path of Object.keys(spec.paths)) if (!path.startsWith('/')) errors.push(`path ${path} must start with /`);
  const seenIds = new Set();
  for (const entry of operations(spec)) errors.push(...operationErrors(spec, entry, seenIds));
  for (const ref of new Set(collectRefs(spec))) if (resolvePointer(spec, ref) === undefined) errors.push(`unresolved $ref ${ref}`);
  return errors;
}

function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function anchor(kind, name) {
  return `${kind}-${String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

function refName(ref) {
  return ref.split('/').pop();
}

export function typeLabel(schema) {
  if (!schema || typeof schema !== 'object' || !Object.keys(schema).length) return 'any';
  if (schema.$ref) return `[${refName(schema.$ref)}](#${anchor('schema', refName(schema.$ref))})`;
  if ('const' in schema) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum) return schema.enum.map(value => `\`${JSON.stringify(value)}\``).join(', ');
  for (const key of ['oneOf', 'anyOf']) if (schema[key]) return schema[key].map(typeLabel).join(' or ');
  if (schema.allOf) return schema.allOf.map(typeLabel).join(' and ');
  const types = [schema.type ?? 'object'].flat();
  return types.map(type => (type === 'array' ? `array of ${typeLabel(schema.items)}` : type)).join(' or ');
}

function constraints(schema) {
  const parts = [];
  for (const [key, label] of [
    ['minimum', 'min'],
    ['maximum', 'max'],
    ['minItems', 'min items'],
    ['maxItems', 'max items'],
    ['minLength', 'min length'],
    ['pattern', 'pattern'],
    ['format', 'format'],
    ['default', 'default'],
  ]) {
    if (schema[key] !== undefined) parts.push(`${label} \`${typeof schema[key] === 'string' ? schema[key] : JSON.stringify(schema[key])}\``);
  }
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function fieldRows(spec, schema) {
  const target = schema?.$ref ? resolvePointer(spec, schema.$ref) : schema;
  if (!target?.properties) return [];
  const required = new Set(target.required || []);
  return Object.entries(target.properties).map(
    ([name, property]) =>
      `| \`${name}\` | ${cell(typeLabel(property))} | ${required.has(name) ? 'yes' : 'no'} | ${cell((property.description || '') + constraints(property))} |`,
  );
}

function fieldTable(spec, schema) {
  const rows = fieldRows(spec, schema);
  if (!rows.length) return [`Schema: ${typeLabel(schema)}`, ''];
  const intro = schema?.$ref ? [`Schema: ${typeLabel(schema)}`, ''] : [];
  return [...intro, '| Field | Type | Required | Description |', '| --- | --- | --- | --- |', ...rows, ''];
}

function authText(spec, operation) {
  const requirements = operation.security ?? spec.security ?? [];
  const named = requirements.flatMap(requirement =>
    Object.entries(requirement).map(([scheme, scopes]) => (scopes.length ? `${scheme} (scope: ${scopes.join(', ')})` : scheme)),
  );
  const extension = operation['x-carthagent-auth'];
  if (extension === 'browser-session') return 'Browser session authenticated by the hosting service (`authenticateBrowser` hook).';
  if (extension === 'stripe-signature') return 'Stripe signature in the `stripe-signature` header.';
  return named.length ? named.map(name => `\`${name}\``).join(' or ') : 'None.';
}

function parameterSection(spec, operation, pathItem) {
  const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])].map(p => (p.$ref ? resolvePointer(spec, p.$ref) : p));
  if (!parameters.length) return [];
  return [
    '**Parameters**',
    '',
    '| Name | In | Type | Required | Description |',
    '| --- | --- | --- | --- | --- |',
    ...parameters.map(
      p =>
        `| \`${p.name}\` | ${p.in} | ${cell(typeLabel(p.schema))} | ${p.required ? 'yes' : 'no'} | ${cell((p.description || '') + constraints(p.schema || {}))} |`,
    ),
    '',
  ];
}

function requestSection(spec, operation) {
  const body = operation.requestBody;
  if (!body) return [];
  const lines = [`**Request body** (${body.required ? 'required' : 'optional'})`, ''];
  for (const [type, media] of Object.entries(body.content || {})) lines.push(`Content type \`${type}\`.`, '', ...fieldTable(spec, media.schema));
  return lines;
}

function responseSchemaLabel(spec, response) {
  const media = Object.entries(response.content || {});
  if (!media.length) return 'no body';
  return media
    .map(([type, { schema }]) => {
      const fields = fieldRows(spec, schema).map(row => row.split(' | ')[0].replace(/^\| /, ''));
      return `${type}: ${schema?.$ref ? typeLabel(schema) : fields.length ? `{${fields.join(', ')}}` : typeLabel(schema)}`;
    })
    .join('; ');
}

function responseSection(spec, operation) {
  return [
    '**Responses**',
    '',
    '| Status | Description | Body |',
    '| --- | --- | --- |',
    ...Object.entries(operation.responses).map(
      ([status, response]) => `| ${status} | ${cell(response.description)} | ${cell(responseSchemaLabel(spec, response))} |`,
    ),
    '',
  ];
}

function operationSection(spec, { path, method, operation, pathItem }) {
  return [
    `<a id="${anchor('op', operation.operationId)}"></a>`,
    '',
    `### ${method.toUpperCase()} \`${path}\``,
    '',
    `${operation.summary}.`,
    '',
    ...(operation.description ? [operation.description, ''] : []),
    `Operation ID: \`${operation.operationId}\`. Auth: ${authText(spec, operation)}`,
    ...(operation['x-carthagent-workspace-lease'] ? ['', 'Takes the cross-process workspace lease; answers 409 when another process holds it.'] : []),
    '',
    ...parameterSection(spec, operation, pathItem),
    ...requestSection(spec, operation),
    ...responseSection(spec, operation),
  ];
}

function securitySection(spec) {
  const schemes = Object.entries(spec.components?.securitySchemes || {});
  if (!schemes.length) return [];
  return [
    '## Authentication',
    '',
    ...schemes.flatMap(([name, scheme]) => {
      const where = scheme.type === 'apiKey' ? `${scheme.in} \`${scheme.name}\`` : `HTTP ${scheme.scheme}`;
      return [`- \`${name}\` (${where}): ${scheme.description || ''}`.trimEnd()];
    }),
    '',
  ];
}

function schemaSection(spec) {
  const schemas = Object.entries(spec.components?.schemas || {});
  return [
    '## Schemas',
    '',
    ...schemas.flatMap(([name, schema]) => [
      `<a id="${anchor('schema', name)}"></a>`,
      '',
      `### ${name}`,
      '',
      ...(schema.description ? [schema.description, ''] : []),
      ...(schema.properties ? fieldTable(spec, schema) : [`Type: ${typeLabel(schema)}`, '']),
    ]),
  ];
}

export function renderMarkdown(spec, specPath) {
  const ops = operations(spec);
  const servers = (spec.servers || []).map(server => `\`${server.url}\``).join(', ');
  const lines = [
    `<!-- Generated by tools/generate-api-docs.mjs from ${specPath}. Do not edit by hand; run node tools/generate-api-docs.mjs. -->`,
    '',
    `# ${spec.info.title}`,
    '',
    `Version ${spec.info.version}. OpenAPI source: [${specPath.split('/').pop()}](${specPath.split('/').pop()}).`,
    '',
    ...(spec.info.summary ? [spec.info.summary, ''] : []),
    ...(spec.info.description ? [spec.info.description, ''] : []),
    ...(servers ? [`Servers: ${servers}.`, ''] : []),
    ...securitySection(spec),
    '## Operations',
    '',
    '| Method | Path | Summary |',
    '| --- | --- | --- |',
    ...ops.map(
      ({ path, method, operation }) => `| ${method.toUpperCase()} | [\`${path}\`](#${anchor('op', operation.operationId)}) | ${cell(operation.summary)} |`,
    ),
    '',
    ...ops.flatMap(entry => operationSection(spec, entry)),
    ...schemaSection(spec),
  ];
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

export function generate({ root = ROOT, check = false, docs = API_DOCS } = {}) {
  const problems = [];
  const written = [];
  for (const { spec: specPath, markdown } of docs) {
    const spec = JSON.parse(readFileSync(join(root, specPath), 'utf8'));
    const errors = validateOpenApi(spec);
    if (errors.length) {
      problems.push(...errors.map(error => `${specPath}: ${error}`));
      continue;
    }
    const expected = renderMarkdown(spec, specPath);
    const target = join(root, markdown);
    if (!check) {
      writeFileSync(target, expected);
      written.push(markdown);
      continue;
    }
    let current = null;
    try {
      current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      problems.push(`${markdown}: missing; run node tools/generate-api-docs.mjs`);
      continue;
    }
    if (current !== expected) problems.push(`${markdown}: stale; run node tools/generate-api-docs.mjs`);
  }
  return { problems, written };
}

export function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, root = ROOT } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  const unknown = argv.filter(arg => arg !== '--check');
  if (unknown.length) {
    stderr.write(`Unknown option: ${unknown[0]}\n${USAGE}\n`);
    return 2;
  }
  const check = argv.includes('--check');
  const { problems, written } = generate({ root, check });
  for (const problem of problems) stderr.write(`${problem}\n`);
  if (problems.length) return 1;
  stdout.write(check ? 'API Markdown is up to date.\n' : `Wrote ${written.join(', ')}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
