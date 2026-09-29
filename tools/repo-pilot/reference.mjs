import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function reference(cwd, task, mutant=false) {
 const file=join(cwd,'lib/reply.js');let source=readFileSync(file,'utf8');
 const code=task==='append'?`
Reply.prototype.appendHeader = function (name, input) {
 const { validateHeaderName, validateHeaderValue } = require('node:http')
 if (typeof name !== 'string') throw new TypeError('Invalid name')
 validateHeaderName(name)
 const items = Array.isArray(input) ? input : [input]
 const values = items.map(value => {
  if (!(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) throw new TypeError('Invalid value')
  validateHeaderValue(name, String(value))
  return String(value)
 })
 if (!values.length) return this
 const old = this.getHeader(name)
 const merged = ${mutant?'values':'(old === undefined ? [] : Array.isArray(old) ? [...old] : [old]).concat(values)'}
 this[kReplyHeaders][name.toLowerCase()] = merged
 return this
}
`: `
Reply.prototype.vary = function (input) {
 const items = Array.isArray(input) ? input : [input]
 const parse = values => values.flatMap(value => {
  if (typeof value !== 'string' || /[\\r\\n]/.test(value)) throw new TypeError('Invalid Vary')
  return value.split(',').map(s => s.replace(/^[ \\t]+|[ \\t]+$/g, '')).filter(Boolean).map(token => {
   if (!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(token)) throw new TypeError('Invalid field')
   return token
  })
 })
 const tokens = parse(items)
 if (!tokens.length) return this
 const old = this.getHeader('vary')
 const all = parse(old === undefined ? [] : Array.isArray(old) ? old : [String(old)]).concat(tokens)
 const seen = new Set(), output = []
 for (const token of all) { const key = ${mutant?'token':'token.toLowerCase()'}; if (!seen.has(key)) { seen.add(key); output.push(token) } }
 this.header('vary', seen.has('*') ? '*' : output.join(', '))
 return this
}
`;
 source=source.replace('Reply.prototype.getHeader = function (key) {',code+'\nReply.prototype.getHeader = function (key) {');writeFileSync(file,source);
}
