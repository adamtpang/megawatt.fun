# Base repository ingestion — 2026-10-04

**October 19 update:** the public inventory now contains 12 repositories. Read the [current learning guide](base-repo-learning/README.md) for all 12, the four additions, and the updated web-component revision. The results below describe the October 4 snapshot; the 94-test count is historical.

All eight public BasePowerCompany repositories from the October 4 snapshot are cloned in the sibling research workspace:

`C:\Users\adamp\Aether\base-power-research`

Read its `README.md` for the overview, `notes/repository-guide.md` for architecture and entry points, `notes/contribution-candidates.md` for ranked work, and `notes/repository-manifest.json` for exact revisions and clone scope.

The strongest direct contribution route is `bpc-web-components`, Base's address/ZIP signup component. Its existing 94 tests, TypeScript check, and lint pass locally. The PR workflow does not invoke the tests or type check; that is a confirmed small contribution candidate. A possible stale-autocomplete race is the next product-facing investigation, but still needs a mocked runtime reproduction.

Most other repositories are unchanged upstream forks/vendor imports. The public trees do not expose Base's full product or battery dispatch systems. No source patches, commits, pushes, PRs, deployments, or messages were made during ingestion. These notes are local research, not site content to deploy.
