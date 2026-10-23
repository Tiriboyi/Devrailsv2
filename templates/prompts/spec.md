Write the optional spec for RFC @@ARGS@@.

1. Run `@@cli@@ rfc show @@ARGS@@` and confirm `status: approved`. If it is not approved, stop and tell the user.
2. Run `@@cli@@ spec new --rfc @@ARGS@@`. It copies the RFC's acceptance criteria as headings.
3. Follow `docs/guides/spec-guidelines.md`: refine each criterion with Given/When/Then, concrete values and edge cases; fill in contracts (API, data), measurable non-functional requirements and the test plan.
4. Do not add new criteria. If one is missing, tell the user: the RFC must go back to draft and be re-approved.
5. Reply with the refined criteria and stop for review before writing tests.
