import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { startGateway, MODEL } from './gateway.mjs';
import { TASKS, MATRIX } from './tasks.mjs';
import { safeEnv, provisionTools, ENGINE_RUNTIME, isolatedHome } from './runtime.mjs';
import { campaignAccount } from './campaign.mjs';
import { verifyFreeze } from './freeze.mjs';
import { runNativeEvaluation } from '../../lib/opencode/evaluation.mjs';
import { createServer } from 'node:http';
import { OpenCode } from '@opencode/client';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOT = process.env.CTG_BENCHMARK_ROOT || join(REPO, '.harness/deepseek-jev-v4');
export const CAMPAIGN = process.env.CTG_BENCHMARK_CAMPAIGN || join(REPO, '.harness/deepseek-jev-campaign.json');
export function terminalStatus(events, exit, stopReason, budget, outcome = null) {
  const last = events.filter(e=>e.type==='session.step.ended').at(-1)?.data;
  const status = budget.stopped ? 'infrastructure-error' : stopReason ? stopReason : exit.code!==0 ? 'process-error' : outcome !== 'succeeded' ? 'non-successful-session-outcome' : !last ? 'missing-terminal-message' : last.finish==='error' ? 'model-error' : last.finish!=='stop' ? 'incomplete' : 'completed';
  return { status, terminalModelReason:last?.finish || null, terminalError:last?.error?.message || null, outcome, finalText:'' };
}
export function childEnv(config, gateway, log) {
  const home = isolatedHome(config);
  return safeEnv({ CTG_OPENCODE_HOME: home, CTG_OPENCODE_URL: process.env.CTG_OPENCODE_URL || '', BENCH_GATEWAY: gateway, BENCH_ADVISOR_LOG: log, BENCH_GUARD_LOG: join(dirname(config),'guard.jsonl') }, home);
}
async function waitForService(url, { timeoutMs = 30000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    try { const response = await fetch(`${url}/api/info`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('Isolated OpenCode 2 service readiness timeout');
}
async function startFixtureService(directory) {
  const server = createServer((req,res) => {
    if (req.url === '/api/info') { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({version:'2.0.32'})); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise(resolve => server.close(resolve)), directory };
}
async function startNativeService({ workspace, config, mode, arm, smoke, toolLimit, gateway, apiKey }) {
  const home = isolatedHome(config), configDir = join(home,'.config','opencode');
  mkdirSync(configDir,{recursive:true});
  const provider = arm === 'plain' ? 'benchmark-fixture' : 'benchmark';
  const model = arm === 'plain' ? 'fixture' : MODEL;
  const plugins = [join(REPO,'lib/opencode/evaluation-budget-plugin'), ...(arm === 'plain' ? [] : [join(REPO,'tools/benchmark/native-plugin')])];
  const configJson = {
    '$schema':'https://opencode.ai/config.json', update:'disable', model:`${provider}/${model}`,
    plugins:plugins.filter((_,index)=>mode!=='smoke' || index===0),
    providers:{[provider]:{
      package:'@opencode/ai/providers/openai-compatible',
      settings:{baseURL:`${gateway}/v1`,apiKey:apiKey || 'fixture-no-key'},
      models:{[model]:{limit:{context:100000,output:16384},cost:{input:.3,output:1.2,cacheRead:.006,cacheWrite:0}}},
    }},
  };
  writeFileSync(join(configDir,'opencode.json'),JSON.stringify(configJson,null,2));
  const password=randomBytes(24).toString('hex');
  const env=safeEnv({HOME:home,XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),XDG_STATE_HOME:join(home,'.local/state'),OPENCODE_DB:join(config,'opencode.sqlite'),OPENCODE_SERVER_PASSWORD:password,BENCH_TOOL_LIMIT:String(toolLimit),BENCH_TURN_LIMIT:String(toolLimit),BENCH_TURN_LOG:join(dirname(config),'turns.jsonl'),BENCH_GUARD_LOG:join(dirname(config),'guard.jsonl'),BENCH_GATEWAY:gateway,BENCH_ADVISOR_LOG:join(dirname(config),'advisor.jsonl'),CTG_EVALUATION_MAX_TURNS:String(toolLimit),CTG_EVALUATION_MAX_COST:String(smoke ? .08 : 2.79),OPENROUTER_API_KEY:apiKey || ''},home);
  const proc=spawn(process.env.OPENCODE_BIN || 'opencode',['serve','--hostname','127.0.0.1','--port','0'],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  let output='';
  let endpoint;
  try { endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Isolated OpenCode service startup timeout: ${output}`)),30000);
    const collect=chunk=>{output=(output+chunk.toString()).slice(-16000);const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}};
    proc.stdout.on('data',collect);proc.stderr.on('data',collect);proc.once('error',error=>{clearTimeout(timer);reject(error)});proc.once('exit',code=>{clearTimeout(timer);reject(Error(`OpenCode service exited ${code}: ${output}`))});
  }); } catch(error) {
    if(proc.exitCode===null){const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill('SIGTERM');const kill=setTimeout(()=>proc.kill('SIGKILL'),5000);await exited;clearTimeout(kill);}
    throw error;
  }
  const auth={authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`};
  const client=OpenCode.make({baseUrl:endpoint,headers:auth});
  const request={location:{directory:workspace},signal:AbortSignal.timeout(15000)};
  if (plugins.length) await client.session.create({location:{directory:workspace},model:{providerID:provider,id:model},title:'native plugin activation probe'},request);
  const deadline=Date.now()+15000;
  try {
  if (plugins.length) {
    while(Date.now()<deadline){
      const loaded=await client.plugin.list(request).catch(()=>null);
      const expected = arm === 'plain' ? 'ctg.evaluation-budget' : 'ctg.benchmark';
      const active = loaded?.data?.find(plugin=>plugin.id===expected&&plugin.state?.status==='active');
      const failure=loaded?.data?.find(plugin=>plugin.id===expected&&plugin.state?.status==='error');
      if(active) break;
      if(failure) throw Error(`Native OpenCode plugin failed to activate: ${JSON.stringify(failure)}`);
      if(Date.now()+100>=deadline) throw Error(`Native benchmark plugin did not become active: ${JSON.stringify(loaded)}`);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  const version=(await client.server.info(request)).version;
  return {endpoint,client,auth,child:proc,version,close:async()=>{if(proc.exitCode!==null)return;const done=new Promise(resolve=>proc.once('exit',resolve));proc.kill('SIGTERM');const kill=setTimeout(()=>proc.kill('SIGKILL'),5000);await done;clearTimeout(kill)}};
  } catch(error) {
    if(proc.exitCode===null){const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill('SIGTERM');const kill=setTimeout(()=>proc.kill('SIGKILL'),5000);await exited;clearTimeout(kill);}
    throw error;
  }
}
export async function runCandidate(task, arm, { smoke = false, key, root = ROOT, campaignPath = CAMPAIGN, fetchImpl, promptOverride, toolLimit = 120, nativeRunner = runNativeEvaluation } = {}) {
  if ((!TASKS[task] && !smoke) || !['plain','harness','jev'].includes(arm)) throw Error('Invalid run');
  if (!smoke) { if (promptOverride || toolLimit !== 120 || fetchImpl) throw Error('Candidate overrides forbidden'); verifyFreeze(root); }
  const apiKey = key || process.env.OPENROUTER_API_KEY;
  if (!apiKey && !nativeRunner.fixture) throw Error('Set OPENROUTER_API_KEY explicitly; credential discovery is disabled.');
  const run = join(root, smoke ? `smoke-${arm}` : `${task}-${arm}`), workspace = join(run, 'workspace'), config = join(run, 'config');
  if (existsSync(run)) throw Error(`Run exists; refusing overwrite: ${run}`);
  mkdirSync(root, { recursive: true }); mkdirSync(run); mkdirSync(workspace); mkdirSync(config);
  if (!Number.isInteger(toolLimit) || toolLimit < 1 || toolLimit > 120) throw Error('Invalid tool limit');
  const toolsReceipt = provisionTools(config);
  const gateway = await startGateway({ key: apiKey || 'fixture-only-no-upstream', limit: smoke ? 0.08 : 2.79, allowJev: arm === 'jev', receiptPath: join(run, 'gateway.jsonl'), fetchImpl, account: campaignAccount(campaignPath, smoke ? 'smoke' : 'candidate', run) });
  let fixtureService, nativeService;
  try {
    const env = childEnv(config, gateway.url, join(run,'advisor.jsonl'));
    const prompt = promptOverride || (smoke ? 'Infrastructure smoke only. Read TASK.md and report SMOKE_OK. Do not create a plan or change files.' : TASKS[task]);
    writeFileSync(join(workspace, 'TASK.md'), prompt);
    writeFileSync(join(workspace, '.gitignore'), 'node_modules/\ntarget/\nartifacts/\n.harness/\ndata/\n');
    for (const args of [['init','-q'],['add','.'],['-c','user.name=Benchmark','-c','user.email=benchmark@localhost','commit','-qm','Frozen task']]) {
      const result = spawnSync('git', args, { cwd: workspace, env }); if (result.status) throw Error('Git initialization failed');
    }
    if (nativeRunner.fixture) fixtureService = await startFixtureService(workspace);
    else if (!process.env.CTG_OPENCODE_URL) nativeService = await startNativeService({workspace,config,mode:arm,arm,smoke,toolLimit,gateway:gateway.url,apiKey});
    env.CTG_OPENCODE_URL = process.env.CTG_OPENCODE_URL || nativeService?.endpoint || fixtureService?.url;
    env.CTG_OPENCODE_AUTHORIZATION = nativeService ? nativeService.auth.authorization : '';
    const args = { task, arm, smoke, runtime: ENGINE_RUNTIME, openCodeService: nativeService ? 'dedicated-isolated-service' : process.env.CTG_OPENCODE_URL ? 'explicit-isolated-endpoint' : 'injected-fixture', toolsReceipt, harnessCommit: spawnSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).stdout.trim(), ceilings: { seconds: smoke ? 180 : 900, tools:toolLimit, usd:smoke ? .08 : 2.79 }, startedAt:new Date().toISOString() };
    writeFileSync(join(run,'invocation.json'), JSON.stringify(args,null,2));
    let stopReason = null; const events = [], started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => { stopReason = 'wall-time'; controller.abort(); }, (smoke ? 180 : 900) * 1000);
    let result;
    try { await waitForService(env.CTG_OPENCODE_URL,{signal:controller.signal}); result = await nativeRunner({ directory: workspace, prompt, systemPrompt: arm === 'plain' ? '' : `Use the Carthagent delivery workflow. Required checks: ${JSON.stringify({ toolLimit })}.`, provider:arm === 'plain' ? 'benchmark-fixture' : 'benchmark', model:arm === 'plain' ? 'fixture' : MODEL, timeoutSeconds: smoke ? 180 : 900, maxTurns: toolLimit, maxCost: smoke ? .08 : 2.79, signal: controller.signal, baseUrl: env.CTG_OPENCODE_URL, headers:nativeService?.auth || {}, onEvent: event => { events.push(event); appendFileSync(join(run,'events.jsonl'),JSON.stringify(event)+'\n'); } }); }
    catch (error) { result = { exitCode:1, errors:[error.message], turns:0, productiveTurns:0, tools:{} }; }
    finally { clearTimeout(timer); }
    if (result.outcome !== 'succeeded') {
      result.exitCode = 1;
      result.budgetReason ||= 'missing terminal session outcome';
      result.errors = [...(result.errors || []), 'Native run cannot be successful without outcome=succeeded from session.get().'];
    }
  const classification = terminalStatus(events,{code:result.exitCode},stopReason,gateway.budget,result.outcome);
    if (result.errors?.some(error => /usage|cost/i.test(error)) || result.budgetReason === 'unknown usage; fail-closed') gateway.budget.stopped = 'unknown-or-excess-billing';
    const turnRows=existsSync(join(run,'turns.jsonl'))?readFileSync(join(run,'turns.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const guardRows=existsSync(join(run,'guard.jsonl'))?readFileSync(join(run,'guard.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const final = { task,arm,smoke,...classification,status:classification.status,smokePassed:smoke ? result.exitCode===0 && result.outcome==='succeeded' && !result.budgetReason : undefined, stopReason:result.budgetReason || stopReason, outcome:result.outcome||null, interruptionStatus:result.interruptionStatus||'unknown', terminalAuthority:'session.outcome', costScope:'session', usageSource:'session.get', toolStarts:Object.values(result.tools||{}).reduce((a,b)=>a+b,0), toolAdmittedByBudget:guardRows.filter(row=>!row.blocked).length, toolBlockedByBudget:guardRows.filter(row=>row.blocked).length, wallMs:Date.now()-started,budget:gateway.budget,runtime:ENGINE_RUNTIME,openCodeVersion:result.opencodeVersion||nativeService?.version||'2.0.32',productiveTurns:result.productiveTurns||0, turnAdmission:turnRows,reportedCost:result.cost,finishedAt:new Date().toISOString() };
    writeFileSync(join(run,'result.json'),JSON.stringify(final,null,2)); console.log(JSON.stringify(final)); return final;
  } finally { await nativeService?.close(); await fixtureService?.close(); await gateway.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.env.OPENROUTER_API_KEY;
  const [task,arm]=process.argv.slice(2);
  if(task==='matrix') { verifyFreeze(ROOT); for(const [t,a] of MATRIX) { const result = await runCandidate(t,a,{key}); if(['infrastructure-error','process-error','missing-terminal-message','model-error'].includes(result.status)) throw Error('Matrix stopped on infrastructure/billing failure; retain results and diagnose before any further runs.'); } }
  else await runCandidate(task,arm,{key,smoke:task==='smoke'});
}
