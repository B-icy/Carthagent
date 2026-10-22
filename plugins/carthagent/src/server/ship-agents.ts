import type { Context } from "@opencode/plugin/promise/plugin"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const SHIP_AGENT_ID = "ship"
export const LITE_AGENT_ID = "lite"

const SKILLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../skills")

/**
 * The delivery harness runs only for Ship. A missing agent ID means the host could not
 * identify the mode, so enforcement stays on rather than silently disappearing.
 */
export function isShipAgent(agent: string | undefined | null) {
  return agent === undefined || agent === null || agent === "" || agent === SHIP_AGENT_ID
}

type AgentEditor = Parameters<Parameters<Context["agent"]["transform"]>[0]>[0]
type SkillEditor = Parameters<Parameters<Context["skill"]["transform"]>[0]>[0]

/**
 * Ship deliberately sets no `system` override: the host keeps its native base prompt and the
 * delivery plugin injects the workflow per request, as the legacy extension appended it.
 */
export async function registerShipAgents(ctx: Pick<Context, "agent">) {
  const registration = await ctx.agent.transform((editor: AgentEditor) => {
    editor.update(SHIP_AGENT_ID, item => {
      item.name = "Ship" as unknown as typeof item.name
      item.description = "Carthagent delivery workflow: acceptance contract, implementation, fresh check evidence, review and verified handoff."
      item.mode = "primary"
      item.system = undefined
      item.color = "#e6c480"
      item.permissions.push({ action: "question", resource: "*", effect: "allow" })
    })
    editor.update(LITE_AGENT_ID, item => {
      item.name = "Lite" as unknown as typeof item.name
      item.description = "Direct execution with existing skills and tools. No delivery harness."
      item.mode = "primary"
      item.color = "#b89ce0"
      item.system = "You are a direct execution agent. Use the skills and tools already available and work the task directly. No extra planning ceremony, no harness phases — just do the work well and concisely."
      item.permissions.push({ action: "question", resource: "*", effect: "allow" })
    })
    editor.default(SHIP_AGENT_ID)
  })
  return async () => { await registration.dispose() }
}

function frontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { fields: {} as Record<string, string>, body: raw }
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (field) fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "")
  }
  return { fields, body: raw.slice(match[0].length) }
}

export function bundledSkills(root = SKILLS_ROOT) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const path = join(root, entry.name, "SKILL.md")
    if (!existsSync(path)) return []
    const { fields, body } = frontmatter(readFileSync(path, "utf8"))
    return [{ id: entry.name, name: fields.name || entry.name, ...(fields.description ? { description: fields.description } : {}), path, content: body }]
  })
}

/** Legacy runs passed `--skill skills/`; the native host receives the same skill set. */
export async function registerShipSkills(ctx: Pick<Context, "skill">, root = SKILLS_ROOT) {
  const skills = bundledSkills(root)
  const registration = await ctx.skill.transform((editor: SkillEditor) => {
    for (const skill of skills) if (!editor.get(skill.id)) editor.add(skill as Parameters<SkillEditor["add"]>[0])
  })
  return async () => { await registration.dispose() }
}
