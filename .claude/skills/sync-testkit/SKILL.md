---
name: sync-testkit
description: Re-vendor Story Block's testkit and v2 runtime into tests/vendor/story-block from a Story Block checkout, then run the tests. Use when Story Block's v2 changed something this module relies on, and before the final push of a PR that depends on a host change.
---

# Sync the Story Block testkit

1. Have a Story Block checkout at the commit you want (normally `origin/main`, or the release head before
   a release). The default is `../Story_block`; another place goes in `STORY_BLOCK`:
   ```sh
   git -C ../Story_block fetch -q origin main && git -C ../Story_block checkout -q main && git -C ../Story_block pull -q --ff-only
   ```
   The checkout must be clean: with local changes the VERSION file records `<sha>+local-changes`.
2. Sync (replaces `tests/vendor/story-block/` as a whole, so dropped files do not linger):
   ```sh
   npm run sync-testkit                                  # from ../Story_block
   STORY_BLOCK=/path/to/Story_block npm run sync-testkit # from elsewhere
   ```
   It prints `Copied N files into …/tests/vendor/story-block (commit <sha>)`; `tests/vendor/story-block/VERSION`
   names the commit. `tests/v2/qa/vendor/` is an older pinned copy and is not touched.
3. Run the whole suite once: `npm run test:dot` (see the `run-tests` skill). A test that goes red after a
   sync is a real change in the host: fix this module (or ask in Story Block), never edit the vendored files.
4. Commit it with the change that needs it (or alone), and name the Story Block commit in the message and
   the PR body, as earlier PRs did: "Testkit synced to Story Block v2 <short sha> (#<SB PR>)".
