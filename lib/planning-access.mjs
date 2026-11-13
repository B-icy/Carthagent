// Names are the built-in read-only tools, not inferred shell command strings.
// Unknown/custom tools fail closed. The embedding host remains trusted.
const READ_ONLY = new Set(['read', 'ls', 'find', 'grep', 'code_nav', 'delivery_probe']);
// delivery_small is a contract tool: start creates the plan (like delivery_plan), finish runs checks.
const PLANNING = new Set(['delivery_plan', 'delivery_small', 'delivery_revise', 'delivery_design', 'delivery_status', 'delivery_finish']);
export function needsImplementation(toolName) {
  return !READ_ONLY.has(toolName) && !PLANNING.has(toolName);
}
