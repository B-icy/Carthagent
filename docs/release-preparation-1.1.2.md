# Production release 1.1.2 preparation

The native prebuild recipe selects the complete v18 patch, SHA-256
`636e01c3da517c64a5f90fb1ea6a682a25fbcb2b63372a8fd2c32ec11fe706dd`.
It includes the reviewed question forms and first-use changes. Its only source
delta from v17 is seven label expectations in two tests.

This preparation does not change the public resolver, runtime manifest, package
version, upstream revision, lockfile, test timeouts, or generator revision.
Historical staging tests now distinguish the v18 build recipe from the still-v15
public runtime. The immutable v15/v16/v17/v18 patch comparisons remain enforced.

Next, build all five platforms through the existing prebuild workflow. Promote
only the generated, verified manifest in a separate final version change. Accept
the exact installed package before publishing the GitHub release, npm package,
and stable control-plane pointer through the release workflows.

The existing recipe retains its documented Intel macOS Rename-test waiver.
Local candidate functional acceptance passed, including verified Ship delivery
and typing during the optional review toast. This is not pixel-level approval.
