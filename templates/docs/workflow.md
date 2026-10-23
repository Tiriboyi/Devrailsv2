# How work flows in this repo

```
Ticket ─▶ Analysis ─▶ RFC (draft, AC-1…n) ─▶ human approval ─▶ optional spec
   ─▶ failing tests ─▶ implementation ─▶ refactor ─▶ change record + docs ─▶ PR ─▶ CI gate ─▶ merge
```

| Step | Command | Output | Who |
|---|---|---|---|
| Fetch ticket | `@@cli@@ ticket <id>` | `docs/analysis/TICKET-*.md` | agent |
| Analyse | `/rails-ticket` | understanding, approach, **fit criteria** | agent → you review |
| Request for Change | `@@cli@@ rfc new "<title>"`, `rfc lint` | `docs/rfc/RFC-<yyyy>-<nnn>-*.md` (status: draft) | agent → you review |
| Approve | `@@cli@@ rfc approve <id>` or PR label `@@prLabel@@` | status: approved, approved_by, approved_on | **you only** |
| Start | `@@cli@@ rfc start <id>` | branch `rfc/<yyyy>-<nnn>-*` | agent |
| Spec (optional; strict: required) | `@@cli@@ spec new --rfc <id>` | `docs/specs/SPEC-<yyyy>-<nnn>-*.md` | agent → you review |
| Red / green / refactor | `/rails-implement` | tests referencing `RFC-<yyyy>-<nnn>:AC-n`, code | agent |
| Document | `@@cli@@ done --run-tests` | `docs/changes/CR-<yyyy>-<nnn>-*.md`, CHANGELOG, STATUS, RFC checkboxes + Change History | agent |
| Gate | `@@cli@@ check` | pass / fail | agent, hooks, CI |

## What enforces what
| Rule | Claude Code hook | git hooks | CI |
|---|---|---|---|
| Code changes need an approved, active RFC | blocks the edit | blocks the commit | fails the PR |
| Agents can't approve RFCs | blocks status/approved_by/approved_on changes | — | verifies the approver |
| Approved RFCs don't change | blocks edits (revoking to draft allowed) | — | compares with the approved version |
| Commits reference an RFC | — | blocks the commit | reads RFC ids from branch/commits |
| Every acceptance criterion has a test | — | — | fails the PR |
| Source changes come with test changes | — | warns | fails the PR |
| Change record + CHANGELOG | — | — | fails the PR |
| Scope stays inside `affected_areas` | blocks (strict) | — | warns / fails (strict) |
| No `--no-verify`, no tooling edits | blocks it | — | branch protection |
| Serena edit tools follow the same rules | blocks them like Edit/Write | blocks the commit | fails the PR |

Instructions guide the agent; hooks and CI are what actually enforce. Protect `main` (require pull requests and the `devrailsv2` check) so nothing bypasses the gate.

## Strictness
- **light:** approval enforced; tests, spec and docs only warn.
- **standard:** approval, tests, acceptance-criteria coverage and change records enforced; fast-track allowed; scope warns.
- **strict:** as standard, plus a spec is required, no fast-track, and edits outside `affected_areas` are blocked.

Change it in `.rails/config.json` (with an RFC).
