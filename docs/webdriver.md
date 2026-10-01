# Real-browser checks

`tools/webdriver-check.mjs` runs checks in a real browser. By default it uses
the bundled `chrome-headless-shell` build — a lightweight headless-only
browser downloaded on first use into `~/.carthagent/browser/` (pinned version,
`CARTHAGENT_BROWSER_VERSION` to override, `CARTHAGENT_BROWSER` to supply your
own binary; system Chrome/Chromium is used when present). The bundled browser
is driven directly over the DevTools protocol, so no driver binary or npm
dependency is required.

```sh
node tools/webdriver-check.mjs \
  --root ./my-app --page index.html \
  --assert-text '#status:ready' --click '#submit' \
  --assert-text '#status:saved' --screenshot artifacts/browser.png
```

To drive an external W3C WebDriver service instead (e.g. geckodriver or
chromedriver you manage), pass `--endpoint`:

```sh
geckodriver --host 127.0.0.1 --port 4444 &
node tools/webdriver-check.mjs --endpoint http://127.0.0.1:4444 \
  --root ./my-app --page index.html --assert-text '#status:ready'
```

Options are processed in order. `--assert` checks element existence;
`--assert-text` checks visible text contains the supplied string; `--click`
dispatches a click on the element after it exists. Screenshots use the same
session after all steps. Exit 1 means failure, including unavailable browser
or unsupported options. Requests and navigation have deadlines. The spawned
browser is terminated on success and failure.

For an already running Vite/Next.js or other application server, use
`--url http://127.0.0.1:5173` instead of `--root`/`--page`. Start and stop that
server separately. Only navigate to applications you trust: browser checks
execute their scripts and clicks can change application data.

Element existence and text assertions poll for up to `--wait-ms 5000` per step
(default 5000; integer range 1–60000). Invalid selectors and driver errors fail
immediately. Clicks wait for element existence but are executed exactly once;
interaction errors are not retried. Page navigation has a separate 15-second
timeout. This is a per-step bound, not a whole-run budget.

Failures are JSON with `category` (configuration, launch, driver, capture,
navigation, assertion, interaction, browser-errors, screenshot, or cleanup),
`error`, and where applicable zero-based `stepIndex`, `selector`, and
`expected`. Use this evidence to fix the relevant
step rather than blindly repeating a mutating interaction.
Use meaningful application-state assertions: element existence alone does not
prove that a module ran. Console-error capture is automatic and mandatory —
there is no `--console-clean` flag; it is rejected rather than silently
ignored. Screenshot success is not visual
review. The existing jsdom tool remains useful for classic-script DOM checks,
but rejects unsupported module execution.

Run the optional actual-browser regression from the repository root:

```sh
node tools/test-webdriver.mjs
```

It provisions the bundled browser (first run downloads ~100MB into
`~/.carthagent/browser/`), exercises a module application and broken-module
failure, and writes `artifacts/webdriver.png`.
Default `npm test` tests CLI failures without requiring a browser.

### Mandatory browser-error evidence

Browser error capture subscribes before navigation (DevTools `Runtime` and
`Log` domains; WebDriver endpoints use BiDi `log.entryAdded`), capturing
startup console errors, uncaught exceptions and unhandled promise rejections.
Unexpected error-level entries fail the check even when DOM assertions pass.
Capture-channel failure fails closed; there is no silent DOM-only fallback. Diagnostics accompany assertion failures too and retain at most 50
entries, 2,000 text characters and eight bounded stack frames per entry; dropped
entries are counted. No broad ignore option is provided. Expected-error tests
must currently use a separate explicit validator rather than suppressing logs.

Coverage ends after the declared interactions/assertions and a BiDi round trip;
this is not a promise to detect errors occurring arbitrarily later. Declare a
readiness assertion for asynchronous work. Network failures are not classified
as application errors unless the browser emits an error-level log. Warnings,
visual correctness and all network traffic are not covered by this signal.
