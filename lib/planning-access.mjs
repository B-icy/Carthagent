// Names are the built-in read-only tools, not inferred shell command strings.
// Unknown/custom tools fail closed. The embedding host remains trusted.
const READ_ONLY = new Set(['read', 'ls', 'find', 'grep']);
const PLANNING = new Set(['delivery_plan', 'delivery_revise', 'delivery_design', 'delivery_status', 'delivery_finish']);
export function needsImplementation(toolName) {
  return !READ_ONLY.has(toolName) && !PLANNING.has(toolName);
}
