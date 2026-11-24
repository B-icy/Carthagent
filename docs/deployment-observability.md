# Deployment observability

This page lists where to look after a Carthagent release ships, what "healthy" means, and how to roll back. Alert routing and severities are described in [alerting.md](alerting.md).

A stable release reaches users through four channels, and each must advertise the same version:

| Channel | Published by | What users get |
| --- | --- | --- |
| GitHub release `vX.Y.Z` with five runtime archives (`opencode-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,windows-x64}.tar.gz`) | Maintainer, after the `Accept draft runtime release` workflow passes | The CTG-owned runtime that `ctg` downloads and verifies against `lib/opencode/runtime-release.json` |
| npm `carthagent` with dist-tag `latest` (prereleases use `next`) | `Release` workflow, `publish-npm` job | `npm install -g carthagent` |
| Control-plane update manifest `GET https://api.carthagent.xyz/v1/cli/releases/latest` | `Release` workflow, `publish-release-manifest` job (`POST /v1/cli/releases`) | `ctg update` and the daily update notice on the stable channel (`lib/update.mjs`) |
| Installer `https://carthagent.xyz/install` | Carthagent-Backend site deployment | `curl -fsSL https://carthagent.xyz/install \| sh` |

## Release health monitor

`tools/release-health.mjs` checks all four channels using public, unauthenticated endpoints:

| Check | Pass condition |
| --- | --- |
| GitHub latest release | `releases/latest` exists, is not a draft or prerelease, and has a canonical `vX.Y.Z` tag |
| Runtime archives | All five runtime archives are attached, uploaded and non-empty |
| Runtime archive downloads | Each archive's `browser_download_url` answers `HEAD` with 200 after redirects (`--skip-asset-probe` turns this off) |
| npm `carthagent@latest` | The `latest` dist-tag equals the GitHub release version and that version is published |
| Installer script | `https://carthagent.xyz/install` returns 200 with a `#!` shell script |
| Control-plane update manifest | `/v1/cli/releases/latest` returns a manifest that the CLI's own validator (`normalizeRelease` in `lib/update.mjs`) accepts, advertising the same version |

It also records release-impact metrics that never fail the run: download counts for each asset of the latest release, total runtime archive downloads, and npm downloads for the last week (`api.npmjs.org/downloads/point/last-week/carthagent`).

Each request is retried twice with exponential backoff (1 s, then 2 s) on network errors, timeouts, 408, 425, 429 and 5xx responses. The manifest probe sends `x-carthagent-ci: 1` and no install id, so the control plane never counts the monitor as an install.

Run it locally:

```sh
node tools/release-health.mjs                       # Markdown report; exit 1 when any check fails
node tools/release-health.mjs --json                # Same report as JSON
node tools/release-health.mjs --json-out report.json
CARTHAGENT_CLOUD_URL=https://staging.example node tools/release-health.mjs --cloud-url "$CARTHAGENT_CLOUD_URL"
```

`GITHUB_TOKEN`, when set, is sent only to `api.github.com` to avoid the anonymous rate limit. It is never needed.

### The Release health workflow

[`.github/workflows/release-health.yml`](https://github.com/B-icy/Carthagent/actions/workflows/release-health.yml) runs:

- every 6 hours (`17 */6 * * *`),
- on `workflow_dispatch` (the Release workflow should dispatch it once the manifest is live; see below),
- on `release: published`. This run only reports, because npm and the manifest are published after the GitHub release by design. It never opens an issue or fails.

Each run writes the Markdown report to the job summary (open the run, then **Summary**) and uploads `release-health.json` as the `release-health-<run id>` artifact, kept for 90 days. Download artifacts to compare metrics across runs:

```sh
gh run list --workflow release-health.yml --limit 20
gh run download <run-id> --name release-health-<run-id>
```

When a check fails, the run fails and opens one issue labeled `source: release-health`, `priority: P0` and `area: release`. Later runs comment only when the set of failing checks changes, and the issue closes automatically after the next fully healthy run.

## Where to look

| Signal | Where | Notes |
| --- | --- | --- |
| Release consistency | [Release health runs](https://github.com/B-icy/Carthagent/actions/workflows/release-health.yml), the job summary of each run | Source of truth for "is the release live everywhere" |
| Runtime archive downloads | GitHub release page, or `gh release view vX.Y.Z --json assets --jq '.assets[] \| [.name, .downloadCount] \| @tsv'` | One download per fresh runtime install for each platform; compare platforms |
| npm downloads | <https://www.npmjs.com/package/carthagent>, <https://npm-stat.com/charts.html?package=carthagent>, and the release health metrics table | npm counts include CI and mirrors; use them for trends, not absolute users |
| Installs and version adoption | Carthagent-Backend operator dashboard: the `/admin` overview (active and new installs) and `/admin/product` (installs by version, OS/architecture and provider mode, daily active installs) | Populated by the update check. The CLI sends metadata-only headers (`x-carthagent-install-id`, `x-carthagent-version`, `x-carthagent-os`, `x-carthagent-arch`, `x-carthagent-node`, `x-carthagent-provider-mode`; see `lib/ship-telemetry.mjs`). CI runners send `x-carthagent-ci: 1` and are excluded. The dashboard is owned by the Carthagent-Backend repository and requires operator authorization |
| Crashes | Issues labeled [`source: crash-report`](https://github.com/B-icy/Carthagent/issues?q=label%3A%22source%3A+crash-report%22) | Users file these from the crash report form; `ctg doctor` prefills the form from the local redacted report under `~/.carthagent/logs/`. Group by the crash fingerprint and the version field |
| Broken workflows | Issues labeled [`source: ci-alert`](https://github.com/B-icy/Carthagent/issues?q=label%3A%22source%3A+ci-alert%22) | Opened by the CI alert workflow; see [alerting.md](alerting.md) |

## Post-release checklist

| When | Action |
| --- | --- |
| T+0 | The `Release` workflow publishes npm and the control-plane manifest. Confirm both jobs passed and that the release health run it dispatched passed. If the dispatch step is not in place yet, run `gh workflow run release-health.yml`. |
| T+1h | Open the latest release health run. Every check must pass. Record the npm weekly downloads and the per-asset download counts from the summary as the baseline. |
| T+24h | Compare against the baseline and the previous release: the share of active installs on the new version (`/admin/product`), runtime archive downloads per platform, new `source: crash-report` issues for the new version (any fingerprint that did not exist on the previous version needs triage), and any open `source: ci-alert` or `source: release-health` issue. |
| T+7d | Make sure the previous version's share of installs is still declining. If adoption has stalled, check the manifest version and `npm view carthagent dist-tags`. |

Roll back if a P0 regression is confirmed (broken install, data loss, billing or security) and a forward fix is more than a few hours away.

## Rollback

Rollback moves every pointer back to the previous good version `P` (for example `1.1.2`). Never delete or unpublish the bad version, because installers and lockfiles may already reference it.

1. Point npm `latest` back to `P` (this needs an npm token with publish rights on `carthagent`):

   ```sh
   npm dist-tag add carthagent@P latest
   npm view carthagent dist-tags
   ```

2. Re-publish the control-plane manifest for `P`. This is the same request the `Release` workflow sends. The backend stores a single pointer and overwrites it on every publish, so publishing an older version is accepted and takes effect within the 60-second response cache:

   ```sh
   curl -fsS -X POST "${CARTHAGENT_CLOUD_URL:-https://api.carthagent.xyz}/v1/cli/releases" \
     -H "authorization: Bearer ${CARTHAGENT_CLI_RELEASE_TOKEN}" \
     -H 'content-type: application/json' \
     -d '{"version":"P","minNode":"22.22.2"}'
   curl -fsS https://api.carthagent.xyz/v1/cli/releases/latest
   ```

   `CARTHAGENT_CLI_RELEASE_TOKEN` is the backend's `CARTHAGENT_CLI_RELEASE_ADMIN_TOKEN`. Use the `minNode` from `P`'s `package.json` `engines.node` floor. Do not paste the token into shell history on shared machines.

3. Mark the bad GitHub release as a prerelease so that `releases/latest`, which is the CLI fallback when the control plane is unreachable, resolves to `P` again:

   ```sh
   gh release edit vBAD --prerelease --latest=false
   gh release edit vP --latest
   ```

4. Ask affected users to move back with `ctg update --channel stable`. After steps 1 and 2, the stable pointer names `P`. Plain `ctg update` reports that an install of the bad version is ahead of the latest release and stops. An explicit `--channel stable` (or `--force`) installs `P` anyway and also resets anyone who switched to the beta or experimental channel. Users without a working `ctg` can run `npm install -g carthagent@P`.

5. Run `gh workflow run release-health.yml`. Expect it to report `P` as healthy, then post a comment on the incident issue and close it.

## Deployment summary in the Release workflow

The `report-release-health` job in `.github/workflows/release.yml` runs for stable tags after `publish-npm` and `publish-release-manifest` have both succeeded. It writes a deployment summary (version, commit, GitHub release, npm page, health workflow and this runbook) and dispatches `release-health.yml` on `main`. Waiting for both publish jobs keeps the first health run from reporting the previous version as `npm latest` or as the update manifest. The job needs `actions: write` so the token can dispatch workflows.
