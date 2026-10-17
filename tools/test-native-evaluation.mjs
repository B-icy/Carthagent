#!/usr/bin/env node
/** Real isolated OpenCode 2 host + local provider; no provider spend. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { nativeFixture, streamText } from './native-fixture.mjs';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

const host = await nativeFixture({ plugin:resolve(import.meta.dirname,'../lib/opencode/evaluation-budget-plugin'), env:{CTG_EVALUATION_MAX_TURNS:'4',CTG_EVALUATION_MAX_COST:'1'}, respond(body,res) {
  if (body.messages.at(-1)?.content === 'CTG_FIXTURE_FAILURE') {
    res.writeHead(400,{'content-type':'application/json'});
    res.end(JSON.stringify({error:{message:'Deterministic provider rejection',type:'invalid_request_error'}}));
  } else streamText(res);
} });
try {
  const { client, cwd: directory, location, model, request } = host;
  await host.active('ctg.evaluation-budget',location);
  const unrelated = await client.session.create({ location, model, title:'unrelated session' }, request());
  await client.session.prompt({ sessionID:unrelated.id, text:'Generate unrelated fixture usage' }, request());
  await host.outcome(unrelated.id);
  const result = await runNativeEvaluation({ client, directory, prompt:'Run bounded fixture task.', provider:model.providerID, model:model.id, timeoutSeconds:30, maxTurns:4, maxCost:1 });
  assert.equal(result.runtime,'opencode-2');
  assert.equal(result.exitCode,0,JSON.stringify(result));
  assert.equal(result.outcome,'succeeded');
  assert.equal(result.turns,1,JSON.stringify(result));
  assert.equal(result.lastStop,'stop');
  assert.notEqual(result.sessionID,unrelated.id);
  assert.ok(Number.isFinite(result.cost),JSON.stringify(result));
  const own = await client.session.get({sessionID:result.sessionID},request());
  assert.equal(result.cost,own.cost,'use exact session aggregate cost');
  assert.equal(result.tokens,own.tokens.input+own.tokens.output+own.tokens.reasoning+own.tokens.cache.read+own.tokens.cache.write,'use exact session aggregate tokens');
  const projectStats = await client.session.stats({location},request());
  assert.ok(projectStats.cost > result.cost,'project stats include unrelated usage and must not be used');
  const failed = await runNativeEvaluation({client,directory,prompt:'CTG_FIXTURE_FAILURE',provider:model.providerID,model:model.id,timeoutSeconds:30,maxTurns:4,maxCost:1});
  assert.equal(failed.exitCode,1,JSON.stringify(failed));
  assert.equal(failed.outcome,'failed',JSON.stringify(failed));
  assert.equal(failed.budgetReason,'session failed');
  assert.equal(failed.turns,1,JSON.stringify(failed));
  assert.equal(failed.productiveTurns,0,JSON.stringify(failed));
  assert.ok(failed.providerErrors >= 1,JSON.stringify(failed));
  assert.equal(host.requests.length,3);
  console.log(JSON.stringify({host:'2.0.32',outcome:result.outcome,failureOutcome:failed.outcome,turns:result.turns,cost:result.cost,isolatedFromConcurrentSession:true}));
} finally { await host.close(); }
