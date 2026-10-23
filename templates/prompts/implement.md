Implement RFC @@ARGS@@ test-first.

1. Run `@@cli@@ status`. The RFC must be approved; run `@@cli@@ rfc start @@ARGS@@` if it is not active. Read the RFC and its spec (if any).
2. **Red.** For every acceptance criterion write a failing test that references it as `RFC-<yyyy>-<nnn>:AC-n` in the test name or a comment. Run `@@testCommand@@` and confirm each new test fails for the expected reason (not a typo or setup error). Commit: `RFC-<yyyy>-<nnn>: add failing tests for …`.
3. **Green.** Write the smallest implementation that passes. Stay inside the RFC's `affected_areas`. Commit with the RFC prefix.
4. **Refactor.** Improve names and structure with all tests green. Run the full test suite.
5. If you find the scope has to change, stop: set the RFC back to `status: draft`, describe the change, and ask the user to re-approve.
6. Then follow the `rails-done` steps.
