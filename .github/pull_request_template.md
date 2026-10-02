## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run check` and `npm run example` pass, and the files under `examples/output` are the ones `npm run example` wrote
- [ ] A change to a check or the tokenizer is described in docs/method.md, says what the check can and cannot see, and has a test with the migration written inline and a near miss that must not match
- [ ] A change to a quoted sentence, a lock name, a function name or a keyword follows the manual: the new page text is saved in research/sources, `src/data.js` and docs/rules-and-sources.md match it, and nothing was added from memory
- [ ] A conclusion that the manual does not state is worded as the tool's own, in the message and in docs/method.md
- [ ] Names from a file go through `safeText`, and no value, string or comment of a file is copied into a finding
- [ ] The tool still connects to no database, fetches nothing, opens no connection, and runs no program
- [ ] A thing the tool cannot read is reported as a finding or a note, never skipped and never shown as passed
- [ ] Paths are opened with `path.resolve`, shown relative with forward slashes, and file names are compared by code unit, so the result is the same on Linux, macOS and Windows
- [ ] No real secret in fixtures or examples
- [ ] The commit messages of this pull request follow Conventional Commits
