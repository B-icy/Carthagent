# Production release 1.1.3 preparation

The native prebuild recipe selects the complete v21 patch, SHA-256
`9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92`.
It carries every v20 sidebar fix plus the v21 polish described in
[staged-native-polish-v21.md](staged-native-polish-v21.md).

This preparation does not change the public resolver pin, runtime manifest,
package version, upstream revision, lockfile, test timeouts or generator
revision. The immutable v15 to v20 patch comparisons remain enforced; v20 is
never built on its own.

Next, build all five platforms through the existing prebuild workflow. Promote
only the generated, verified manifest in a separate final version change.
Accept the exact installed package before publishing the GitHub release, npm
package and stable control-plane pointer through the release workflows.

The recipe keeps its documented Intel macOS Rename-test waiver. Local
acceptance of a linux-arm64 build is recorded in the v21 document; it is not
pixel-level visual approval.
