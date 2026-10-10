// Reapply after refreshing the vendored engine. Fail closed if upstream changes.
import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../vendor/agent/chunks/chunk-JVUZSMYM.js', import.meta.url);
let source = readFileSync(path, 'utf8');
if (source.includes('import{boundedSummary,compactionThreshold,serializedContextTokens}')) process.exit(0);
function replaceOnce(from,to) {
  if (source.split(from).length !== 2) throw new Error(`Expected one vendor anchor: ${from.slice(0,100)}`);
  source = source.replace(from,to);
}
source = 'import{boundedSummary,compactionThreshold,serializedContextTokens}from"../bounded-summary.mjs";\n' + source;
for (const name of ['shouldCompact','shouldCompact2']) replaceOnce(`function ${name}(contextTokens,contextWindow,settings2){return settings2.enabled&&Number.isFinite(contextWindow)&&contextWindow>0?contextTokens>contextWindow-settings2.reserveTokens:!1}`,`function ${name}(contextTokens,contextWindow,settings2){return settings2.enabled&&Number.isFinite(contextWindow)&&contextWindow>0?contextTokens>compactionThreshold(contextWindow,settings2.reserveTokens):!1}`);
replaceOnce('return retryAssistantCall(async()=>streamFn?(await streamFn(model,context,requestOptions)).result():completeSimple(model,context,requestOptions),retry,requestOptions.signal,callbacks)', 'return boundedSummary(model,context,requestOptions,(boundedContext,boundedOptions)=>retryAssistantCall(async()=>streamFn?(await streamFn(model,boundedContext,boundedOptions)).result():completeSimple(model,boundedContext,boundedOptions),retry,boundedOptions.signal,callbacks))');
const summaryCall = 'response=await request({systemPrompt:SUMMARIZATION_SYSTEM_PROMPT2,messages:summarizationMessages},createSummaryRequestOptions(completionOptions,context),context)';
if (source.split(summaryCall).length !== 3) throw new Error('Expected history and turn-prefix summary calls');
source = source.replaceAll(summaryCall, 'response=await boundedSummary(model,{systemPrompt:SUMMARIZATION_SYSTEM_PROMPT2,messages:summarizationMessages},createSummaryRequestOptions(completionOptions,context),(boundedContext,boundedOptions)=>request(boundedContext,boundedOptions,context))');
// Include serialized UTF-8 size even when cached-token usage is available.
for (const [from,to] of [
  ['return{tokens:estimated,usageTokens:0,trailingTokens:estimated,lastUsageIndex:null}', 'return{tokens:Math.max(estimated,serializedContextTokens(messages)),usageTokens:0,trailingTokens:estimated,lastUsageIndex:null}'],
  ['return{tokens:usageTokens+trailingTokens,usageTokens,trailingTokens,lastUsageIndex:usageInfo.index}', 'return{tokens:Math.max(usageTokens+trailingTokens,serializedContextTokens(messages)),usageTokens,trailingTokens,lastUsageIndex:usageInfo.index}'],
]) {
  if (source.split(from).length !== 3) throw new Error('Expected both context estimator paths');
  source=source.replaceAll(from,to);
}
writeFileSync(path,source);
