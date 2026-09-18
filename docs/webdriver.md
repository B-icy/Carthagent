# Real Firefox checks

`tools/webdriver-check.mjs` is an opt-in W3C WebDriver client. Install Firefox
and geckodriver separately; no browser downloads or npm dependencies are added.
Start a local driver (never expose it to untrusted networks):

```sh
mkdir -p artifacts/firefox-profiles
geckodriver --host 127.0.0.1 --port 4444 --profile-root "$PWD/artifacts/firefox-profiles"
```

In another terminal:

```sh
node tools/webdriver-check.mjs --endpoint http://127.0.0.1:4444 \
  --root ./my-app --page index.html \
  --assert-text '#status:ready' --click '#submit' \
  --assert-text '#status:saved' --screenshot artifacts/browser.png
```

Options are processed in order. `--assert` checks element existence;
`--assert-text` checks visible text contains the supplied string; `--click`
uses WebDriver's native element click. Screenshots use the same session after
all steps. Exit 1 means failure, including unavailable driver or unsupported
options. Requests and navigation have deadlines. Sessions are deleted on
success and failure; a dead driver may require operator process cleanup.

This serves static workspace files, not a framework development server.
Build the application first where necessary. Browser page load completion is
awaited, but arbitrary asynchronous application readiness is not polled.
Use meaningful application-state assertions: element existence alone does not
prove that a module ran. Console errors are **not captured**; `--console-clean`
is rejected rather than silently ignored. Screenshot success is not visual
review. The existing jsdom tool remains useful for classic-script DOM checks,
but rejects unsupported module execution.

Run the optional actual-browser regression from the repository root:

```sh
node tools/test-webdriver.mjs
```

It requires Firefox/geckodriver, launches a temporary local driver, exercises a
module application and broken-module failure, and writes `artifacts/webdriver.png`.
Default `npm test` tests CLI failures without requiring a browser installation.
