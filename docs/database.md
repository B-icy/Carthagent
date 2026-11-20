# Database access

The Cloud service stores its ledger, control plane and gateway state in SQLite
through `node:sqlite` `DatabaseSync` (`lib/cloud/ledger.mjs`,
`lib/cloud/control-plane.mjs`, `lib/cloud/gateway.mjs`). Schema changes for
deployed databases live in `migrations/`.

## Query budgets

`tests/helpers/sql-query-counter.mjs` wraps one `DatabaseSync` instance and
counts executed statements by normalized SQL: every `run`, `get`, `all` and
`iterate` call on a prepared statement and every `exec` call counts once.

```js
import { countQueries } from './helpers/sql-query-counter.mjs';

const counter = countQueries(ledger.db);
const { result, total, statements } = counter.measure(() => control.account(accountId));
counter.restore();
```

`tests/cloud-query-count.test.mjs` uses it to keep data access free of N+1
queries:

- Read paths (`available`, `entries`, `account`, `grants`, `usage`,
  `listSessions`, `subscription`, `verifyAccessToken`, gateway `models`,
  `resolveAlias`, `request`) run the same statements for 1 and 50 rows, and
  each has an exact budget (for example `account()` is 5 statements).
- Write paths are linear only where the design requires it: `reserve` debits
  and allocates once per credit grant it spans, `settle` and `release` touch
  each allocation once, and `grant` and `claimTrial` are constant.

To add a budget, seed a fixture at two sizes, measure the call with
`counter.measure`, assert that no statement count grows between the sizes, and
add the exact total to `READ_BUDGETS`. A budget increase needs a reason in the
change, not just a new number.
