import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway, MODEL } from './gateway.mjs';
import { TASKS, MATRIX } from './tasks.mjs';
import { safeEnv, provisionTools, ENGINE, stopGroup, sha } from './runtime.mjs';
import { campaignAccount } from './campaign.mjs';
import { verifyFreeze } from './freeze.mjs';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOT = '/home/baissi/benchmarks/deepseek-jev-v4';
export const CAMPAIGN = '/home/baissi/benchmarks/deepseek-jev-campaign.json';
export function terminalStatus(events, exit, stopReason, budget) {
  const last = events.filter(e=>e.type==='message_end' && e.message?.role==='assistant').at(-1)?.message;
  const finalText = (last?.content || []).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const status = budget.stopped ? 'infrastructure-error' : stopReason ? stopReason : exit.code!==0 ? 'process-error' : !last ? 'missing-terminal-message' : last.stopReason==='error' ? 'model-error' : last.stopReason==='aborted' ? 'aborted' : last.stopReason!=='stop' ? 'incomplete' : 'completed';
  return {status, terminalModelReason:last?.stopReason || null, terminalError:last?.errorMessage || null, finalText};
}
export function childEnv(config, gateway, log) {
  return safeEnv({ PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', PI_TELEMETRY: '0', BENCH_GATEWAY: gateway, BENCH_ADVISOR_LOG: log, BENCH_GUARD_LOG: join(dirname(config),'guard.jsonl') });
}
export async function runCandidate(task, arm, { smoke = false, key, root = ROOT, campaignPath = CAMPAIGN, fetchImpl, promptOverride, toolLimit = 120 } = {}) {
  if ((!TASKS[task] && !smoke) || !['plain','harness','jev'].includes(arm)) throw Error('Invalid run');
  if (!smoke) { if (promptOverride || toolLimit !== 120 || fetchImpl) throw Error('Candidate overrides forbidden'); verifyFreeze(root); }
  const run = join(root, smoke ? `smoke-${arm}` : `${task}-${arm}`), workspace = join(run, 'workspace'), config = join(run, 'config');
  if (existsSync(run)) throw Error(`Run exists; refusing overwrite: ${run}`);
  mkdirSync(root, { recursive: true }); mkdirSync(run); mkdirSync(workspace); mkdirSync(config);
  if (!Number.isInteger(toolLimit) || toolLimit < 1 || toolLimit > 120) throw Error('Invalid tool limit');
  const toolsReceipt = provisionTools(config);
  const gateway = await startGateway({ key, limit: smoke ? 0.08 : 2.79, allowJev: arm === 'jev', receiptPath: join(run, 'gateway.jsonl'), fetchImpl, account: campaignAccount(campaignPath, smoke ? 'smoke' : 'candidate', run) });
  try {
  const env = { ...childEnv(config, gateway.url, join(run, 'advisor.jsonl')), BENCH_TOOL_LIMIT: String(toolLimit) };
  writeFileSync(join(config, 'auth.json'), '{}');
  // No toolExecution CLI setting exists; retain the same engine default in all arms.
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { benchmark: { baseUrl: gateway.url + '/v1', api: 'openai-completions', apiKey: 'benchmark-local-placeholder', models: [{ id: MODEL, reasoning: true, input: ['text'], contextWindow: 100000, maxTokens: 16384, cost: { input: .30, output: 1.20, cacheRead: .006, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter', maxTokensField: 'max_tokens', supportsStore: false } }] } } }));
  const prompt = promptOverride || (smoke ? 'Infrastructure smoke only. Use read on TASK.md, ls, find with pattern TASK.md, and grep for Infrastructure in TASK.md. Then say SMOKE_OK. Do not create a delivery plan or change files.' : TASKS[task]);
  writeFileSync(join(workspace, 'TASK.md'), prompt);
  writeFileSync(join(workspace, '.gitignore'), 'node_modules/\ntarget/\nartifacts/\n.harness/\ndata/\n');
  for (const args of [['init','-q'],['add','.'],['-c','user.name=Benchmark','-c','user.email=benchmark@localhost','commit','-qm','Frozen task']]) {
    const result = spawnSync('git', args, { cwd: workspace, env }); if (result.status) throw Error('Git initialization failed');
  }
  const tools = ['read','bash','edit','write','grep','find','ls'];
  const args = [ENGINE, '--mode','json','-p','--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--no-approve','--provider','benchmark','--model',MODEL,'--thinking','high','--session-dir',join(run,'sessions')];
  args.push('-e', join(REPO,'tools/benchmark/guard.ts'));
  if (arm !== 'plain') {
    tools.push('delivery_plan','delivery_revise','delivery_design','delivery_progress','delivery_check','delivery_review','delivery_status','delivery_finish');
    args.push('-e',join(REPO,'extensions/delivery.ts'),'--skill',join(REPO,'skills/software-delivery/SKILL.md'),'--append-system-prompt',`Carthagent documentation paths: ${join(REPO,'docs/tested-planning.md')} (read for exact design/review schema). Use these absolute paths rather than looking for harness docs in the empty task workspace.`);
  }
  if (arm === 'jev') args.push('-e', join(REPO,'tools/benchmark/advisor.ts'));
  args.push('--tools', tools.join(','), prompt);
  writeFileSync(join(run,'invocation.json'), JSON.stringify({ task, arm, smoke, toolsReceipt, transport: 'fresh-curl-http1.1', engine: ENGINE, engineVersion: '0.85.1', transportHash: sha(readFileSync(join(REPO,'tools/benchmark/transport.mjs'))), harnessCommit: spawnSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).stdout.trim(), args, ceilings: { seconds: smoke ? 180 : 900, tools:toolLimit, usd:smoke?.08:2.79 }, startedAt:new Date().toISOString() },null,2));
  let count = 0, pending = '', stopReason = null; const events = []; const decoder = new TextDecoder(); const started = Date.now();
  const child = spawn(process.execPath,args,{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});
  const kill = reason => { stopReason ||= reason; try { process.kill(-child.pid,'SIGTERM'); } catch {} setTimeout(()=>{ try {process.kill(-child.pid,'SIGKILL');} catch {} },2000).unref(); };
  child.stdout.on('data', chunk => {
    appendFileSync(join(run,'events.jsonl'),chunk); pending += decoder.decode(chunk, {stream:true});
    let nl; while ((nl=pending.indexOf('\n'))>=0) { const line=pending.slice(0,nl); pending=pending.slice(nl+1); try { const e=JSON.parse(line); if(e.type==='message_end') events.push(e); if(e.type==='tool_execution_start') count++; if(e.type==='tool_execution_end' && e.result?.content?.some(c=>c.text?.includes('Benchmark tool budget exhausted before execution.'))) kill('tool-budget'); } catch {} }
  });
  child.stderr.on('data',chunk=>appendFileSync(join(run,'stderr.log'),chunk));
  const timer=setTimeout(()=>kill('wall-time'),(smoke?180:900)*1000);
  let exit;
  try { exit=await new Promise((r,j)=>{child.once('error',j);child.once('exit',(code,signal)=>r({code,signal}));}); }
  finally {clearTimeout(timer); await stopGroup(child);}
  const classification = terminalStatus(events, exit, stopReason, gateway.budget);
  const guardRows = existsSync(env.BENCH_GUARD_LOG) ? readFileSync(env.BENCH_GUARD_LOG,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const result={task,arm,smoke,...exit,...classification, smokePassed:smoke ? classification.status==='completed' && classification.finalText.includes('SMOKE_OK') : undefined, stopReason,toolStarts:count,toolAdmittedByBudget:guardRows.filter(r=>!r.blocked).length, toolBlockedByBudget:guardRows.filter(r=>r.blocked).length,wallMs:Date.now()-started,budget:gateway.budget,finishedAt:new Date().toISOString()};
  writeFileSync(join(run,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result)); return result;
  } finally { await gateway.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json','utf8')).openrouter.key;
  const [task,arm]=process.argv.slice(2);
  if(task==='matrix') { verifyFreeze(ROOT); for(const [t,a] of MATRIX) { const result = await runCandidate(t,a,{key}); if(['infrastructure-error','process-error','missing-terminal-message','model-error'].includes(result.status)) throw Error('Matrix stopped on infrastructure/billing failure; retain results and diagnose before any further runs.'); } }
  else await runCandidate(task,arm,{key,smoke:task==='smoke'});
}
