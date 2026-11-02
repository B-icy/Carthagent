# Beta rewards and new-user acceptance

Owner-approved policy: one eligible `ctg` verified delivery earns **25 coins,
100 XP and 1 km**, at most three grants per player per UTC day. Daily classifier
assessment and personal work-log completion do not earn these rewards.

## Execution plan

1. Preserve the current live account and capture its starting profile. Confirm
   account identity through normal authentication; never select an account by
   a display name supplied to a public endpoint.
2. Implement a versioned backend reward receipt and atomic coin/XP/km posting.
   Derive owner from authentication and amounts from server policy. Retain
   delivery identity across retries and enforce daily caps under a player lock.
3. Integrate an explicit native claim action. Require a current required-check
   verified handoff, fresh source fingerprint, passing check/requirement/review
   gates and stable project/run identity. Do not reward advisory or blocked work.
4. Run a disposable real-PostgreSQL lifecycle through normal HTTP/auth routes:
   new user, one welcome grant, isolation, eligible reward, exact replay,
   conflicting/parallel claims, daily cap, rollback, level/week boundaries,
   purchase/equip and application/database reconnect persistence. Exercise
   rejection paths and reconcile wallet postings against balances.
5. Run backend checks and native eligibility/RPC/UI checks. Deploy the backend
   only via reviewed PR, merge and its existing deployment workflow.
6. On the owner's Beshir Aissi account, claim the existing accepted Ship delivery
   once; replay it; confirm exactly +25 coins/+100 XP/+1 km, then compare native
   and web persisted state. Keep test fixtures separate from earned live records.
7. Record actual results, limitations and exact revisions, then resume beta
   publication with installed-package and public-runtime acceptance gates.

## Trust boundary

The coding harness verifies local execution and source freshness. An authenticated
client transmits a bounded receipt; the backend does not independently execute
the repository. Client attestation is not remote execution attestation or proof
of authorship. Server amounts, owner isolation, durable deduplication and caps
must hold even for malformed or replayed clients. Tests must not equate a private
debug coin grant with an earned coding reward.

## Original baseline

Live profile previously verified: 20 coins, 0 XP, sandals owned/equipped. Current
backend has no coding-reward path. Quest policy explicitly returns `rewards:false`.
Beta publication is held until this additional acceptance scope is resolved.

Execution results are recorded in [beta-rewards-e2e-results.md](beta-rewards-e2e-results.md).
Production earned claim/replay/restart acceptance now passes at 45 coins,
100 XP and 1 km; live browser and release-package acceptance remain pending.
