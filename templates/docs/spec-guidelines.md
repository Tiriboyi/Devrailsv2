# Spec guidelines

Acceptance criteria are written **in the RFC** (`## Acceptance Criteria`, as `- [ ] AC-1: …`) and approved with it. They are the contract between the person who asked, the agent that builds, and the tests that verify.

A spec (`@@cli@@ spec new --rfc <id>`) is optional in light/standard mode and required in strict mode. It refines the RFC's criteria (Given/When/Then, concrete values, contracts, edge cases) but never adds new ones; a missing criterion means the RFC goes back to draft for re-approval.

## The rules for acceptance criteria
1. **One id per criterion:** `- [ ] AC-1: …`, `- [ ] AC-2: …`. Never renumber after tests reference them; retire a criterion by striking it through and adding a new one (with re-approval).
2. **One behaviour per criterion.** If you write "and" in the Then, consider splitting it.
3. **Given / When / Then**, in the language of the user or the API consumer, not the implementation.
4. **Observable outcomes only:** a response, a stored record, an emitted event, a message on screen. Not "calls the repository".
5. **Concrete values** beat adjectives: "returns 422 with `errors.email`" beats "rejects invalid input".
6. **Cover the unhappy paths:** validation errors, not found, unauthorised, forbidden, conflicts, timeouts, empty lists, limits.
7. **Every criterion is testable.** If you can't imagine the test, the criterion is too vague.

### Good and bad examples
| Bad | Good |
|---|---|
| The export should be fast. | AC-4: **Given** 10,000 invoices **When** I export them **Then** the CSV is returned within 5 seconds. |
| Users can't see other tenants' data. | AC-5: **Given** I belong to tenant A **When** I GET `/invoices/{id}` for a tenant-B invoice **Then** I get 404 (not 403) and nothing is logged with the invoice contents. |
| Handle errors properly. | AC-6: **Given** the payment provider times out **When** I submit payment **Then** the order stays `Pending`, I get 503 with `retryAfter`, and no duplicate charge is created on retry. |

### UI criteria
UI tickets come with screenshots; criteria must still be checkable without them:
- Name the **state** (empty, loading, error, long content, no permission) and the **viewport** (e.g. 375 px, 1280 px).
- Describe layout as observable facts ("the total stays visible while the table scrolls"), not "looks like the screenshot".
- Include interaction and accessibility: keyboard reachable, visible focus, labels for screen readers.
- Test with component tests for states and interaction, and end-to-end or visual-regression tests (e.g. Playwright screenshots) for layout per viewport.

## Linking tests to criteria
Every test that proves a criterion mentions it in its name or a comment, exactly as `RFC-2026-007:AC-3`:

```js
// Node (node:test / Jest / Vitest)
test('RFC-2026-007:AC-3 rejects an export larger than 50k rows', async () => { /* … */ });
```
```csharp
// C# (xUnit)
[Fact] // RFC-2026-007:AC-3
public async Task Export_larger_than_50k_rows_is_rejected() { /* … */ }
```

`devrailsv2 check` fails when a criterion has no test referencing it. `devrailsv2 spec show` lists the coverage. `devrailsv2 done --run-tests` ticks a criterion's checkbox in the RFC once a test references it and the suite passes.

## Test-first (TDD) in this repo
1. **Red:** write the tests for the criteria first and run them. They must fail *for the right reason* (the behaviour is missing, not a typo or broken setup).
2. **Green:** write the smallest code that passes.
3. **Refactor:** improve the design with the tests green.

Where strict TDD does not fit:
- **Spikes / prototypes:** throwaway code on a spike branch, never merged. The real change gets its own RFC and tests.
- **UI layout, infrastructure, pure configuration:** add `test_exemption: <reason>` to the RFC frontmatter. A human approves it with the RFC, and it is recorded in the change record.
- **Bugs:** always start with a failing reproduction test; it becomes the fit criterion for the ticket.
- **Migrations:** start with characterization tests against the old system, then make the same tests pass against the new one.

## Choosing test types
| What the criterion is about | Test type |
|---|---|
| A business rule or calculation | Unit |
| An HTTP endpoint, status codes, validation, auth | Integration (real HTTP pipeline, test database) |
| A contract with another system | Contract test or recorded fixtures |
| Behaviour that must match the old system | Characterization / golden test, run against both |
| A data migration | Before/after counts and checksums |

## Checklist before asking for review
- [ ] Every criterion in the RFC has an id, Given/When/Then wording, and a concrete outcome
- [ ] Unhappy paths and authorization are covered
- [ ] Contracts (API, data) are written down
- [ ] Non-functional requirements are measurable or absent
- [ ] The test plan maps every criterion to at least one test
- [ ] Open questions are listed, not guessed
