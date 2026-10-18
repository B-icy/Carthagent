# Owned-runtime workflow registration bootstrap

This PR registers `.github/workflows/publish-owned-opencode-runtime.yml` on
`main` so GitHub can expose its `workflow_dispatch` entry point. The workflow
was copied byte-for-byte from reviewed source candidate
`70882269e25ebcb62c843f9265345342b9e6844d`; its checkout and build inputs are
selected by explicit reviewed source SHA, so this registration PR does not
include or imply approval of the product candidate.

After this bootstrap is independently reviewed and approved/merged, a
non-publishing prebuild may be dispatched against the reviewed source branch
only after that exact source candidate receives independent approval. The
workflow binds the requested source SHA to the dispatch commit. Publish mode
remains restricted to the default branch and revalidates the exact final
package manifest and immutable candidate bytes. This PR does not authorize a
dispatch, build, publish, or release upload; each requires its own review and
approval.
