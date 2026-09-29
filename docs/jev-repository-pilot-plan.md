# Integrated Jev + repository pilot: plan and author challenge

User authorized implementation and execution. New campaign: at most $15 conservative total ($14 candidates, $1 diagnostics), no automatic retries or release of unknown holds. Preserve V1–V4. This is an exploratory pilot, not the held-out repeated suite.

## Architecture

1. Advisor transport: extend built-in Jev adapter with explicit OpenRouter support; fixed public endpoint or explicit trusted loopback broker for credential isolation. Bounded response/time/input, no retries. Existing direct TypeSafe remains supported.
2. Planning orchestration: pure/advisory service records identity-bound attempts before network dispatch, max three/run; repeat inspect of identical run/revision/digest/source reuses receipt. Store advice in report and expose in recovery/status. Never changes gates, capture IDs, findings or requirements. Missing/bad configuration means unavailable, not clean advice. Explicit extension flags enable and choose provider; env key only used after opt-in. Benchmark uses this production path, not separate advisor extension.
3. Reviewer: compact instruction asks model to address >=0.5 topics in normal review, without making probability a defect or approval. No new compulsory review field that could fake comprehension.
4. Pilot runner: pinned real Node repository feasible without heavy DB services. Two additive feature tickets across public API/implementation/types/docs/regression tests. Three arms, one run/task/arm, balanced order, same engine/model/settings/limits, native compaction on. Plain/harness/Jev differences explicit. Online official reference retrieval equal in all arms; this is documentation access, not open-ended web research.
5. Evaluator: supervisor reference patch and wrong-implementation mutants; behavioral tests on unmodified base must fail, reference pass, mutants fail. Protected evaluation after frozen candidate. Relevant upstream baseline tests and candidate tests reported separately. Final delivery not inferred from external pass.
6. Execution: establish filesystem isolation for candidates and supervisor secrets/evaluators where possible using unprivileged user/mount namespaces; never claim sandbox without testing. Check source fingerprints/large repo compatibility, real installed engine, Jev, >100KB transport and native compaction before candidates. Freeze source/base/task/evaluator hashes before measured attempts.

## Challenges before coding (author review, not independent)

- No budget silently inherited: fresh exclusive campaign, explicit $15 ceiling including unresolved reservations.
- Jev availability does not prove plan quality; scores may miss defects and dispositions remain model-authored.
- Reading key only after explicit enable; no arbitrary configurable remote URLs/exfiltration or persisted credentials.
- Durable reservation before request avoids re-dispatch on resume; errors preserve attempt and no automatic retry.
- Full recovery must contain relevant advice identity/mode, but never duplicate full plan/provider responses.
- Tests must cover same-identity reuse, revisions/source identity, cap, disabled/missing keys, timeout, malformed values and no gate mutation.
- Real repository selection must be based on local feasibility, not treatment outcomes. Small library feature pilots are less representative than full commerce apps; report scope honestly.
- Native compaction enabled identically and billed; request byte ceiling remains separate, not 'fixed' by raising it.
- One replicate cannot establish Jev benefit. All failures/partial results retained, no repair after evaluator feedback.
- Environment failure stops pilot; no synthetic success or 'pi cannot handle it' assumption.
