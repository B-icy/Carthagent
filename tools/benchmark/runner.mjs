import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway, MODEL } from './gateway.mjs';
import { TASKS, MATRIX } from './tasks.mjs';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOT = '/home/baissi/benchmarks/deepseek-jev-v2';
const ENGINE = '/home/baissi/.nvm/versions/node/v26.7.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';
export function childEnv(config, gateway, log) {
  return { HOME: '/home/baissi', USER: 'baissi', PATH: `/home/baissi/.cargo/bin:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/snap/bin`, LANG: 'C.UTF-8', CI: '1', PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', PI_TELEMETRY: '0', BENCH_GATEWAY: gateway, BENCH_ADVISOR_LOG: log };
}
export async function runCandidate(task, arm, { smoke = false, key } = {}) {
  if ((!TASKS[task] && !smoke) || !['plain','harness','jev'].includes(arm)) throw Error('Invalid run');
  const run = join(ROOT, smoke ? `smoke-${arm}` : `${task}-${arm}`), workspace = join(run, 'workspace'), config = join(run, 'config');
  if (existsSync(run)) throw Error(`Run exists; refusing overwrite: ${run}`);
  mkdirSync(workspace, { recursive: true }); mkdirSync(config);
  const gateway = await startGateway({ key, limit: smoke ? 0.08 : 2.84, allowJev: arm === 'jev', receiptPath: join(run, 'gateway.jsonl') });
  const env = childEnv(config, gateway.url, join(run, 'advisor.jsonl'));
  writeFileSync(join(config, 'auth.json'), '{}');
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, toolExecution: 'sequential' }));
  writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { benchmark: { baseUrl: gateway.url + '/v1', api: 'openai-completions', apiKey: 'benchmark-local-placeholder', models: [{ id: MODEL, reasoning: true, input: ['text'], contextWindow: 100000, maxTokens: 16384, cost: { input: .30, output: 1.20, cacheRead: .006, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter', maxTokensField: 'max_tokens', supportsStore: false } }] } } }));
  const prompt = smoke ? 'Infrastructure smoke test only. Use ls once on the current directory, then say SMOKE_OK. Do not create a delivery plan or change files.' : TASKS[task];
  writeFileSync(join(workspace, 'TASK.md'), prompt);
  writeFileSync(join(workspace, '.gitignore'), 'node_modules/\ntarget/\nartifacts/\n.harness/\ndata/\n');
  for (const args of [['init','-q'],['add','.'],['-c','user.name=Benchmark','-c','user.email=benchmark@localhost','commit','-qm','Frozen task']]) {
    const result = spawnSync('git', args, { cwd: workspace, env }); if (result.status) throw Error('Git initialization failed');
  }
  const tools = ['read','bash','edit','write','grep','find','ls'];
  const args = [ENGINE, '--mode','json','-p','--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--no-approve','--provider','benchmark','--model',MODEL,'--thinking','high','--session-dir',join(run,'sessions')];
  if (arm !== 'plain') {
    tools.push('delivery_plan','delivery_revise','delivery_design','delivery_progress','delivery_check','delivery_review','delivery_status','delivery_finish');
    args.push('-e',join(REPO,'extensions/delivery.ts'),'--skill',join(REPO,'skills/software-delivery/SKILL.md'),'--append-system-prompt',`Carthagent documentation paths: ${join(REPO,'docs/tested-planning.md')} (read for exact design/review schema). Use these absolute paths rather than looking for harness docs in the empty task workspace.`);
  }
  if (arm === 'jev') args.push('-e', join(REPO,'tools/benchmark/advisor.ts'));
  args.push('--tools', tools.join(','), prompt);
  writeFileSync(join(run,'invocation.json'), JSON.stringify({ task, arm, smoke, engine: ENGINE, engineVersion: '0.85.1', harnessCommit: spawnSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).stdout.trim(), args, ceilings: { seconds: smoke ? 180 : 900, tools:120, usd:smoke?.08:2.84 }, startedAt:new Date().toISOString() },null,2));
  let count = 0, pending = '', stopReason = null; const started = Date.now();
  const child = spawn(process.execPath,args,{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});
  const kill = reason => { stopReason ||= reason; try { process.kill(-child.pid,'SIGTERM'); } catch {} setTimeout(()=>{ try {process.kill(-child.pid,'SIGKILL');} catch {} },2000).unref(); };
  child.stdout.on('data', chunk => {
    appendFileSync(join(run,'events.jsonl'),chunk); pending += chunk.toString();
    let nl; while ((nl=pending.indexOf('\n'))>=0) { const line=pending.slice(0,nl); pending=pending.slice(nl+1); try { const e=JSON.parse(line); if(e.type==='tool_execution_start' && ++count > 120) kill('tool-budget'); } catch {} }
  });
  child.stderr.on('data',chunk=>appendFileSync(join(run,'stderr.log'),chunk));
  const timer=setTimeout(()=>kill('wall-time'),(smoke?180:900)*1000);
  let exit;
  try { exit=await new Promise((r,j)=>{child.once('error',j);child.once('exit',(code,signal)=>r({code,signal}));}); }
  finally {clearTimeout(timer); try { process.kill(-child.pid,'SIGTERM'); } catch {} await gateway.close();}
  const result={task,arm,smoke,...exit,stopReason,toolStarts:count,wallMs:Date.now()-started,budget:gateway.budget,finishedAt:new Date().toISOString()};
  writeFileSync(join(run,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json','utf8')).openrouter.key;
  const [task,arm]=process.argv.slice(2);
  if(task==='matrix') { if(!existsSync(join(ROOT,'freeze.json'))) throw Error('Freeze evaluators first'); for(const [t,a] of MATRIX) { const result = await runCandidate(t,a,{key}); if(result.budget.stopped) throw Error('Matrix stopped on infrastructure/billing failure; retain results and diagnose before any further runs.'); } }
  else await runCandidate(task,arm,{key,smoke:task==='smoke'});
}
