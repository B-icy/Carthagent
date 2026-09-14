---
name: typescript-delivery
description: TypeScript and JavaScript implementation guidance for phased delivery. Use for Node.js, browser, and full-stack TS/JS tasks. Covers module systems, testing frameworks, DOM/BOM, npm/ecosystem patterns, and common pitfalls.
---
# TypeScript & JavaScript delivery

Read this before implementing any task that targets Node.js, a browser, or a TS/JS runtime. These are the patterns that separate a working delivery from a plausible-looking one.

## Before you write

1. **Check what already exists.** Read `package.json`, `tsconfig.json`, `node_modules/` (if present), and the existing test setup. Match the project's module system (`"type": "module"` vs CommonJS), TypeScript strictness, and test framework — don't introduce a second framework or a different module system.
2. **Check the Node version.** `node --version` determines which APIs are available (e.g. `structuredClone` needs Node 17+, `fetch` is global in Node 18+). Use `node:test` (built-in, no install) unless the project already uses a different test framework.
3. **Verify the entry point.** For a Node project, confirm the `main`/`exports`/`bin` fields in `package.json`. For a browser project, confirm the `<script>` tag or bundler entry point exists.

## Module system

- **`"type": "module"`** → use `import`/`export`, `.mjs`/`.js` extensions are equivalent, `require` is unavailable. Use `import.meta.url` for `__dirname` equivalent.
- **CommonJS (default)** → use `require`/`module.exports`, `.cjs`/`.js` extensions. Don't mix `import` and `require` in the same file.
- **Dual packages** → if `package.json` has both `main` and `module`, the bundler decides. Don't assume both work identically.
- **Dynamic `import()`** works in both systems; `require` doesn't work in ESM. For conditional loading, use `await import()`.

## TypeScript specifics

- **`tsc --noEmit`** is the minimum type check. If `tsconfig.json` exists, run it before declaring done.
- **`strict: true`** means `null`/`undefined` are explicit, `any` is banned by convention, and `unknown` is the safe catch-all. Use `unknown` over `any` for untyped data.
- **Declaration files** (`.d.ts`) are for types only — no runtime code. `declare module 'x'` declares a type for an untyped package; it doesn't create the module.
- **`tsconfig.json` `target`/`module`** controls downleveling. `module: "NodeNext"` matches Node's ESM; `module: "CommonJS"` matches CJS. Mismatch causes runtime `require`/`import` errors.
- **`skipLibCheck: true`** is common but hides type errors in `.d.ts` files — check for actual type errors, not just missing declarations.

## Testing

- **`node:test`** (built-in): `import { test } from 'node:test'; import assert from 'node:assert';`. Run with `node --test tests/`. No install needed.
- **`vitest` / `jest`**: check `package.json` for the test script and the test file pattern (`*.test.ts`, `*.spec.ts`, `*.test.mjs`). Don't add a second test framework — use what the project already has.
- **DOM testing**: use `jsdom` or `happy-dom` for headless DOM; don't fake `document`/`window` manually. For real browser testing, use Playwright/Puppeteer if installed.
- **Browser checks**: pi2 ships a self-contained check tool (path injected into the delivery guidance). Declare it as a `runtime` check in `delivery_plan` — it serves the workspace over HTTP, runs jsdom assertions with real inline-script execution (clicks, text, selectors, console-error detection), and captures a real Firefox screenshot into `artifacts/` when Firefox is installed. No browser download needed.
- **Async tests**: always `await` promises in tests. An unhandled rejection in a test can pass silently if the test framework doesn't track it. Use `assert.rejects` / `assert.resolves` for error paths.

## Common pitfalls

- **`fetch` is global in Node 18+** but not in older versions. Check `node --version` before using it; polyfill or use `undici`/`node-fetch` if needed.
- **`path.join` vs `path.resolve`**: `resolve` is absolute, `join` is relative. Use `resolve` for file paths that must be absolute; use `join` for relative paths within a known base.
- **`fs` vs `fs/promises`**: `fs` is callback-based; `fs/promises` is async/await. Prefer `fs/promises` in modern code. For synchronous operations (init, config loading), use `fs.readFileSync` etc.
- **JSON parsing**: `JSON.parse` throws on malformed input — wrap it in try/catch when reading user data or config files. `JSON.stringify` is lossy for `undefined`, functions, and `Map`/`Set`.
- **Timers**: `setTimeout`/`setInterval` return `Timer` objects, not numbers, in Node. `clearTimeout(timer)` is the correct way to cancel. `setTimeout` doesn't block — don't rely on it for sequencing.
- **`process.exitCode` vs `process.exit()`**: setting `exitCode` lets the process finish pending I/O before exiting; `process.exit()` kills it immediately. Use `exitCode` in libraries; use `exit()` only in CLI entry points.
- **`console.error` writes to stderr**, `console.log` to stdout. Tests that check output should distinguish stdout from stderr.

## Browser specifics

- **ESM in browsers**: `<script type="module" src="...">` for modules; plain `<script>` for classic scripts. Modules have their own scope — top-level `var`/`let` don't leak to `window`.
- **`DOMContentLoaded`**: scripts with `defer` or `type="module"` run after DOM is ready. For non-deferred scripts, wait for `DOMContentLoaded` before accessing DOM elements.
- **`fetch` CORS**: browser `fetch` to a different origin requires CORS headers on the server. `mode: 'no-cors'` gives an opaque response you can't read. For local development, use a local server or a CORS proxy.
- **`localStorage`/`sessionStorage`**: synchronous, string-only, ~5MB limit. Wrap access in try/catch (private browsing can throw). Don't store objects — `JSON.stringify` them.
- **Event listeners**: `addEventListener` returns the element, not a cleanup function. Store the listener reference to call `removeEventListener` later. `element.addEventListener('click', handler)` — don't use `onclick` for multiple handlers.
- **`innerHTML`**: setting it recreates the DOM tree, losing event listeners and state. Prefer `createElement`/`appendChild` or `insertAdjacentHTML` for partial updates.

## Async patterns

- **`async`/`await`**: `await` unwraps a `Promise` or returns the value directly. `Promise.all` runs in parallel; `Promise.allSettled` collects all results even if some reject; `Promise.race` returns the first to settle.
- **Unhandled rejections**: a `Promise` that rejects without a `.catch()` can crash Node (since v15) or log a warning in browsers. Always attach `.catch()` or `await` inside `try/catch`.
- **Top-level `await`**: works in ES modules (Node 14.8+, browsers). In CommonJS, wrap in an `async` IIFE or use `.then()`.
- **`Array.map(async)`**: `map` with async returns an array of Promises, not resolved values. Use `await Promise.all(arr.map(async ...))` to wait for all.

## Packaging & deployment

- **`npm install` vs `npm ci`**: `ci` installs exactly from `package-lock.json` (reproducible); `install` resolves ranges and updates the lockfile. Use `npm ci` in CI/test environments.
- **`npx`**: runs a package without installing it globally. `npx tsc` uses the project's local TypeScript if installed, or downloads it. Prefer `npx` over `npm install -g` for one-off tools.
- **`node_modules`**: never commit it. It's excluded from the source fingerprint by default. Use `package.json` + `package-lock.json` to declare dependencies.
- **`.env` files**: use `dotenv` or `process.env` directly. Never commit `.env` to the repo; add it to `.gitignore`. Read secrets via `process.env.VAR_NAME`, not by importing `.env` as a module.
