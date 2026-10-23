Finish the active RFC @@ARGS@@.

1. If Serena is connected, run `get_diagnostics_for_file` on every changed file and fix errors first.
2. Run `@@cli@@ done --run-tests` (add `--rfc <id>` if needed). If tests fail, fix them first; never weaken a test to pass.
3. Complete the generated change record in `docs/changes/`: Summary, Fit-criteria evidence (each fit criterion and RFC acceptance criterion with the test that proves it and its result), Known limitations and follow-ups. Don't edit the generated section.
4. Update `docs/STATUS.md`: "Where we are", "In flight" and "Next step".
5. If the change introduced an architecture decision, add an ADR with `@@cli@@ adr new "<decision>"`.
6. Run `@@cli@@ check` and fix everything it reports. Commit with the RFC prefix.
7. Reply with a short summary, the check result and any warnings. Do not merge.
