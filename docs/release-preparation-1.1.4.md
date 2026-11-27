# Release preparation: Carthagent 1.1.4

This is preparation only. No tag, GitHub release, asset upload, npm publication
or control-plane update is authorized or performed by this change.

## Scope

Includes the changes since 1.1.3 from
[#318](https://github.com/B-icy/Carthagent/pull/318),
[#305](https://github.com/B-icy/Carthagent/pull/305),
[#306](https://github.com/B-icy/Carthagent/pull/306) and
[#319](https://github.com/B-icy/Carthagent/pull/319), including the follow-up
user-home and workflow fixes. See
[draft release notes](release-notes-1.1.4.md).

Also includes the reviewed dependency updates in
[#320](https://github.com/B-icy/Carthagent/pull/320),
[#321](https://github.com/B-icy/Carthagent/pull/321),
[#323](https://github.com/B-icy/Carthagent/pull/323),
[#324](https://github.com/B-icy/Carthagent/pull/324) and
[#325](https://github.com/B-icy/Carthagent/pull/325), with scoped parser-security,
DOM-readiness and release-checkout regression fixes. The incompatible
TypeScript 7 proposal in
[#322](https://github.com/B-icy/Carthagent/pull/322) was closed, not included.

The reviewed lockfile audit on 2026-11-25 reports 29 moderate advisories,
0 high and 0 critical, compared with 38 moderate and 1 high before cleanup.
The `body-parser` high-severity advisory is fixed. This is an audit snapshot,
not a claim of a vulnerability-free release. Remaining moderate findings
have not been suppressed.

The root package and both root lockfile versions become 1.1.4. The private
plugin's independent version stays unchanged. The runtime manifest's
`releaseVersion` also becomes 1.1.4 because the resolver requires it to match
the installed package.

## Runtime identity

Runtime patch v21 is unchanged:
`9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92`.
Source revision, lock digest, compatibility version, runtime version, archive
digests and executable digests are identical to 1.1.3. No rebuild or new trust
pins are proposed.

The resolver uses a version-specific asset URL and cache directory. Therefore,
unchanged binaries do not mean that an upgrade avoids a download. The 1.1.4
release still needs all five exact, reviewed runtime archives at its own tag,
plus the matching manifest and checksum asset. Do not bypass the manifest
version check or point the new package at an old release to make CI pass.

## Confirmed CI blocker

The Linux native-host and installed-package jobs in
[the preparation CI run](https://github.com/B-icy/Carthagent/actions/runs/45520429517)
fail while acquiring the owned runtime, with
`The exact Carthagent runtime release was not found.`
The v1.1.4 release and assets have not been staged. Ordinary lint, build and
unit-test success does not clear this final-artifact blocker. Keep this PR
draft until the approved artifact sequence and acceptance gates are complete.

## Remaining release gates

- [ ] Review this preparation PR and its checks.
- [ ] Stage the existing exact runtime archives under the approved release
      process, verify their digests and produce the matching manifest and
      checksum asset. Missing v1.1.4 assets currently block native integration
      CI until this step is complete.
- [ ] Follow the approved main/tag ancestry and draft-asset sequence in
      [the owned-runtime release procedure](opencode-owned-runtime.md).
- [ ] Run the full installed-package gate against the exact final artifacts,
      with the owned runtime required and no narrowed probes.
- [ ] Complete draft acceptance and obtain release-owner approval before
      publishing the GitHub release.
- [ ] Run the post-publication Release workflow, including its anonymous
      runtime acquisition gate, npm publication and update-manifest publication.
- [ ] Confirm release health succeeds after both publish jobs finish.
- [ ] Replace draft wording and update current-stable documentation only when
      publication has actually completed.

Local package/version checks and ordinary CI are not substitutes for these
final-artifact gates. No fresh interactive UI approval or paid model evaluation
is claimed by this documentation and version-only change.
