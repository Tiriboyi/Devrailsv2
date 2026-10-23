# SPEC-@@key@@: @@title@@

RFC: [RFC-@@key@@](../rfc/@@rfcFile@@)
Created: @@date@@

> Optional detail for the RFC. The acceptance criteria themselves live in the RFC and are approved there.
> This spec refines them (Given/When/Then, contracts, edge cases) and must not add new criteria; if you
> need one, set the RFC back to draft, add it, and ask for re-approval.
> Tests reference criteria as `RFC-@@key@@:AC-1`. Guidelines: `docs/guides/spec-guidelines.md`.

## Acceptance criteria in detail

@@acList@@

## Contracts

### API
| Method | Path | Request | Success | Errors |
|---|---|---|---|---|

### Data
Schema changes, migrations, and how existing data is handled.

## Non-functional requirements
Only those that apply, each measurable (e.g. "p95 < 300 ms at 50 rps", "only role Admin may …").

## Test plan
| Criterion | Test type | Test name / location |
|---|---|---|
@@testPlan@@

## Open questions
