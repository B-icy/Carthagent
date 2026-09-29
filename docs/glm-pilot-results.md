# GLM 5.3 Flash — complete six-cell repository pilot results

## Outcome

All six planned cells attempted/evaluated. **Plain pi/vary is the only completed end-to-end delivery.** Four saved implementations (both plain, both Carthagent without Jev) pass all seven protected behavior categories, external TypeScript contract and94 original regressions. Passing these finite categories does not satisfy missing docs, broken candidate tests or unfinished final review. Both Jev-enabled cells never reached inspection: **zero Jev calls**, no efficacy comparison possible.

## Frozen conditions

Exact `z-ai/glm-5.3-flash`, high reasoning request; same pi0.85.1/Node26.7.0, pinned Fastify f15d4eaba03d86786bec2de7aed1236718c813f9, exact appendHeader/vary task contracts and evaluators. Updated planning-startup guide/checkpoints in treatments. One replicate/task/arm, order append plain/harness/Jev then vary Jev/harness/plain.900s/120 tool attempts/$2.30/100 paid requests, <=3 Jev,16,384 output tokens,400KB raw input. Native compaction30k threshold/6k recent. Protected evaluator unavailable during generation. Namespace isolation, no host credentials in child, local accounted broker. Official Node/RFC documentation frozen read-only, **not live web research or browser UI/full-stack tasks**.

Author-created feature tickets in a real384-file repository; prior task exposure means this is not new held-out validation. Changed generator AND startup guidance confound comparisons to DeepSeek. Provider routing varied substantially. No superiority or causal Jev claim.

Before execution: exact-model guide/read smoke succeeded; real native GLM compaction smoke succeeded;94 original tests passed inside sandbox. Frozen source/runtime/dependency/reference/system manifest verified unchanged after all six cells and before report additions. Freeze schema includes generator/prices. Source commits2cb89cd (GLM),8aa9546 (startup fixes),4480597 (execution protocol).

## Results

| Task | Arm | Actual stop | Seconds | Tools | Behavior | External types | Original regressions | Known cost | Unknown hold |
|---|---|---|---:|---:|---:|---|---|---:|---:|
| appendHeader | Plain pi |900s wall-time|900.290|24|7/7|Pass|94 pass|$0.0251503150|$0|
| appendHeader | Carthagent |900s wall-time, in-flight cancellation|900.277|66|7/7|Pass|94 pass|$0.1402945740|$0.15|
| appendHeader | Carthagent+Jev |180s provider deadline during compaction|548.458|20|1/7*|Missing API|94 unchanged-base pass|$0.0412539500|$0.15|
| vary | Plain pi |Completed|289.537|41|7/7|Pass|94 pass|$0.0219138100|$0|
| vary | Carthagent |900s wall-time, in-flight cancellation|900.257|50|7/7|Pass|94 pass|$0.0595476160|$0.15|
| vary | Carthagent+Jev |900s wall-time, in-flight cancellation|900.261|37|1/7*|Missing API|94 unchanged-base pass|$0.0779632455|$0.15|

* Unmodified base passes invalid-input category because missing-method invocation throws TypeError. This known base-selftest limitation is not implemented functionality; remaining positive categories fail. Do not score1/7 as useful product progress. Protected tests are finite, not exhaustive semantics/security/performance validation.

Raw runner calls in-flight wall-time cancellation `infrastructure-error` because its legacy classification prioritizes unknown billing. Preserve raw result; `resource:wall-time` and supervisor900s timer are the meaningful stop classification. No candidate hit input-byte/output-token/tool/request limits. Sum4439.080s sequential candidate runtime (~74min),238 tool starts.

## Candidate tests, docs and handoff

- **append/plain:** product runtime/types pass external checks. No requested docs update. Candidate `test/internals/reply-append-header.test.js` reports failures and hangs; supervisor20s process-group-bounded rerun timed out. Test directly constructs Reply with incomplete request context, uses t.plan with standalone node:assert, and contains HTTP tests with cleanup risks. Candidate originally ran unbounded shell pipelines around this suite, consuming much of wall time. No final answer.
- **append/harness:** implementation, docs and type tests present. Supervisor reran12 new unit tests, standalone HTTP probe and full tsd: all pass. Declared check evidence eventually all passing after initial typecheck failure. Planning revision4, approval obtained, final delivery_review inspect performed but no record/finish. Later boundary probes included incorrect assumptions (e.g. tab values treated as invalid though Node allows them) and consumed remaining time; cannot count as verified delivery.
- **vary/harness:** runtime and public type declaration pass external checks, but docs missing. New unit suite and4 HTTP tests fail assertion-plan accounting: t.plan counts test-context assertions, while candidate uses standalone node:assert, yielding zero counted assertions. Its declared type command fails TS1259 due to missing compatible compiler flag for an existing dependency. These are candidate test/configuration failures, not externally demonstrated feature failures. Revision2 approved; only baseline recorded in delivery_check evidence. Repeated progress calls used unrecognized string step identifiers against string-array steps, returning invalid index. No final review/finish.
- **vary/plain:** implementation, docs, type declarations/type tests,15 new runtime tests and final handoff. Supervisor reran15/15 and full tsd successfully. Actual full upstream borp rerun: **2,157 tests,2,152 passed,5 skipped,0 failed**, exit0. Candidate also ran this suite and lint; supervisor independently confirmed runtime suite, not every lint/markdown claim. An initial supervisor invocation guessed wrong borp path (`cli.js`) and failed MODULE_NOT_FOUND; retained separately, corrected to package's `borp.js` without modifying candidate. Not a candidate failure.
- **Both Jev arms:** no product implementation; schema/workflow repairs only. No inspect/approval or final delivery. No Jev call/charge/advice disposition.

No supervisor repaired candidates or fed evaluator output back. Supervisor test reruns happened after termination, under original sandbox, saved separately. Untracked test files retained and included in candidate checks; git diff --stat alone omits them.

## Planning/startup observations

First delivery_plan attempt at tool7 append/harness,10 append/Jev,5 vary/harness,10 vary/Jev. Unlike prior DeepSeek treatments, all attempted a plan. However two Jev-arm first plans needed retries; 'attempted' is not 'valid'. Cannot assign improvement solely to guide since model also changed.

- append/harness:13 design calls (2 guide/3 validate/2 inspect/4 review/2 approve),4 revision attempts; reached implementation.
- vary/harness:7 design calls (1 guide/2 validate/1 inspect/2 review/1 approve); reached implementation.
- append/Jev:missing acceptance, unknown patch field, missing revision reason and repeated schema repairs;3 validations,0 inspections. Provider timeout during later compaction.
- vary/Jev:authored optional workflow with invalid node types/references/effects, repeated rejected revisions,2 validations,0 inspections; wall-time exhausted.
- Successful native compactions: append plain0/harness3/Jev1; vary plain0/harness3/Jev3. No byte-overflow proves only these runs stayed below the local cap, not that context growth is solved.

Schema usability remains a bottleneck even with guide. Optional workflow authoring, per-scenario review shape and progress-step identifiers are concrete next simplification targets without weakening acceptance/evidence policy. Do not add probabilistic Jev syntax repair; neither Jev-enabled trajectory reached the existing semantic trigger. Their poorer outcome cannot have been caused by advice that never ran.

## Provider errors and continuation

After append/Jev request timed out at180s (`ABORTED`), matrix stopped. Supervisor inspected receipts and launched **only unstarted vary cells** via preserved `continue-vary.mjs`; no retry of interrupted candidate, no source/settings/task changes. This is a disclosed exploratory continuation. Native engine attempted locally refused calls after budget closure in some failures, not new upstream paid dispatches.

Returned GLM identity exact, endpoints included SiliconFlow,Z.AI,Fireworks,Relace,AtlasCloud,GMICloud,Phala,Together,InferenceNet,Novita,Modal,StreamLake. Vary/plain used Z.AI only; latency/cost comparisons confounded by routing. High reasoning requested; provider-reported reasoning token counts vary. No conclusion that all timeouts originate in model rather than provider path.

## Accounting

- Six GLM candidates known **$0.3661235105**, unknown reservations **$0.60**.
- GLM readiness known **$0.00699846** (basic smoke$0.00234681 + compaction$0.00465165).
- This GLM round conservative **$0.9731219705** including holds/readiness.
- Entire shared repository-pilot campaign (prior DeepSeek attempts+smokes+GLM): candidate known$0.6230796385, smoke known$0.0183102796, unknown candidate holds$1.35. **Known$0.6413899181 + held$1.35 = $1.9913899181**, within original announced$15.

Holds are not confirmed charges or free requests. No arbitrary release/account reset; not a vendor-wide spending cap. Earlier unrelated$27 campaign untouched.

## Findings and next step

GLM plus startup repairs gets Carthagent into implementation in two cells, but **zero Carthagent final deliveries**, only one final delivery overall. Plain pi remains strongest complete-delivery baseline in this sample. Jev efficacy remains entirely unmeasured. Do not run more paid matrices until schema/workflow friction and candidate testing/time management are addressed with reliable end-to-end fixtures; then rerun fresh tasks with repetitions and fixed/equally documented routing where feasible.

Artifacts: `/home/baissi/benchmarks/glm-repo-pilot-v1/{freeze.json,summary.json,matrix.log,continuation.log,continue-vary.mjs}`, each cell's events/sessions/workspace/invocation/gateway/result/evaluation/type/regression logs and post-run candidate-check receipts. Historical runs unchanged. Report is author analysis, not independent review; no PR/remote CI/merge claimed.
