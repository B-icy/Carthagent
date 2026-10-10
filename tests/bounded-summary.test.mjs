import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boundedSummary, summaryByteBudget, compactionThreshold, serializedContextTokens } from '../vendor/agent/bounded-summary.mjs';

const model = {contextWindow:150000,maxTokens:32768};
const ctx = text => ({systemPrompt:'Summarize only.',messages:[{role:'user',content:[{type:'text',text}],timestamp:0}]});
const ok = text => ({stopReason:'stop',content:[{type:'text',text}],usage:{input:10,output:3,totalTokens:13,cost:{total:0.01}}});

test('large Unicode history is covered completely in bounded map/reduce requests', async () => {
  const text = '🙂漢字"\\\n'.repeat(40000) + 'IMPORTANT FINAL INSTRUCTION';
  const fragments = [], ids = [], requests = [];
  const result = await boundedSummary(model,ctx(text),{maxTokens:12000},async (context,options)=>{
    assert.ok(Buffer.byteLength(JSON.stringify(context)) <= summaryByteBudget(model));
    assert.ok(options.maxTokens >= 16);
    ids.push(options.sessionId); requests.push(context);
    const prompt=context.messages[0].content[0].text;
    if(prompt.includes('<fragment>')) fragments.push(prompt.split('<fragment>\n')[1].split('\n</fragment>')[0]);
    return ok('Compact checkpoint with paths, constraints and next steps.');
  });
  assert.equal(fragments.join(''),text);
  assert.ok(requests.length>2);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(result.usage.totalTokens,requests.length*13);
  assert.equal(result.content[0].text,'Compact checkpoint with paths, constraints and next steps.');
});

test('request_too_large response halves the budget and recovers', async () => {
  let failures=0,calls=0;
  const result=await boundedSummary({contextWindow:5000},ctx('x'.repeat(15000)),{},async context=>{
    calls++;
    if(Buffer.byteLength(JSON.stringify(context))>5500){failures++;return {stopReason:'error',errorMessage:'400: request_too_large',content:[]};}
    return ok('short summary');
  });
  assert.ok(failures>0);assert.ok(calls>failures);assert.equal(result.content[0].text,'short summary');
});

test('small requests stay single-call; cancellation and incomplete responses fail closed', async () => {
  let calls=0;
  await boundedSummary(model,ctx('small'),{},async()=>{calls++;return ok('summary');});
  assert.equal(calls,1);
  const controller=new AbortController();controller.abort();
  await assert.rejects(boundedSummary(model,ctx('small'),{signal:controller.signal},()=>{throw Error('should not call');}),/abort/i);
  for(const response of [{stopReason:'length',content:[{type:'text',text:'partial'}]},{stopReason:'stop',content:[]},{stopReason:'error',errorMessage:'401 unauthorized'}]) {
    await assert.rejects(boundedSummary(model,ctx('small'),{},async()=>response));
  }
});

test('compaction starts with 30 percent headroom and both engine paths are wired', () => {
  assert.equal(compactionThreshold(150000,16384),105000);
  assert.equal(summaryByteBudget({...model,maxRequestBytes:100000}),50000);
  const source=readFileSync(new URL('../vendor/agent/chunks/chunk-JVUZSMYM.js',import.meta.url),'utf8');
  assert.equal(source.split('contextTokens>compactionThreshold(').length-1,2);
  assert.equal(source.split('response=await boundedSummary(model,{systemPrompt:SUMMARIZATION_SYSTEM_PROMPT2').length-1,2);
  assert.match(source,/return boundedSummary\(model,context,requestOptions/);
  const unicode=[{role:'user',content:'漢字🙂'.repeat(100)}];
  assert.equal(serializedContextTokens(unicode),Math.ceil(Buffer.byteLength(JSON.stringify(unicode))/4));
  assert.equal(source.split('Math.max(usageTokens+trailingTokens,serializedContextTokens(messages))').length-1,2);
});

test('cancellation between chunks stops requests; errors do not silently drop history', async () => {
  const controller=new AbortController();let calls=0;
  await assert.rejects(boundedSummary({contextWindow:2000},ctx('history '.repeat(3000)),{signal:controller.signal},async()=>{
    calls++;controller.abort();return ok('summary');
  }),/abort/i);
  assert.equal(calls,1);
  await assert.rejects(boundedSummary(model,ctx('small'),{},async()=>{throw Error('400 request_too_large');}),/request_too_large|budget/);
});
