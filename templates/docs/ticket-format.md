# Writing tickets for people and AI agents

An AI agent can only build what the ticket says. Everything missing becomes a question (good) or a guess (bad).
`@@cli@@ ticket <id>` fetches a ticket, **downloads its screenshots** so the agent can look at them, and checks it against the parts below. `@@cli@@ ticket lint <id>` runs only the check (exit code 1 if required parts are missing), so you can use it before you hand a ticket to an agent.

## The parts a ticket needs
| Ticket type | Required | Recommended |
|---|---|---|
| **Bug** | Steps to reproduce · Expected behaviour · Actual behaviour · Environment / version | Acceptance criteria ("fixed when") · logs / request ids · screenshot |
| **Feature / user story** | Problem or user story ("As a … I want … so that …") · Acceptance criteria | Out of scope · dependencies / open questions · design |
| **UI / frontend** | Page or component · Current state · Expected result / design · **Screenshot or design link** · Viewports / browsers · Acceptance criteria | Accessibility · steps to reproduce |

The type is detected from labels/tags (`bug`, `frontend`, `ui`, …), the work item type, the area path, or the headings used.
Headings are matched loosely (e.g. "Steps to reproduce", "Repro steps" and "Steps" all count), so the templates below are a guide, not a cage.

## Acceptance criteria: the part that matters most
Each acceptance criterion becomes a numbered criterion in the RFC and a test. Write one observable result per line:
- ✅ `Given I am a Viewer, when I open /invoices, then the Export button is not shown and GET /invoices/export returns 403.`
- ❌ `Export should work properly for the right users.`

## Screenshots (frontend tickets)
Agents look at the screenshots, so make them count:
- Capture the **relevant area**, not the whole monitor; mark the problem with a box or arrow.
- Put **current** and **expected** side by side, or link the design (Figma, etc.).
- Mention the **window width / device** and the **state** (empty list, error, long names, logged in as …).
- **Also describe the problem in words.** Agents read text more reliably than pixels, and text survives when an image can't be downloaded.
- Remove personal data, tokens and customer names. Screenshots are downloaded to `.rails/runtime/tickets/` (git-ignored); `--keep-assets` stores them under `docs/analysis/assets/` instead, which gets committed.

Where images can come from:
- **GitHub:** drag-and-drop into the issue or a comment (`user-attachments`). Downloaded with your gh login or token.
- **Azure DevOps:** pasted into Description / Repro Steps / Acceptance Criteria / comments, or added as attachments. Downloaded with your az login or PAT.
- Images on other hosts are downloaded without credentials; tokens are only ever sent to GitHub or your Azure DevOps organisation.

## GitHub Issues
`init` writes issue forms to `.github/ISSUE_TEMPLATE/`: **Bug report**, **Feature request** and **UI / frontend change**. Blank issues are switched off (`config.yml`); turn them back on there if you need them. The forms render as `### Heading` sections, exactly what the check expects.

## Azure DevOps Boards
Azure DevOps keeps templates in the project, not the repository. Two options:
1. **Create them automatically** (needs permission to manage team templates):
   ```bash
   @@cli@@ ticket templates --azure --team "<Team name>"     # add --dry-run to see what would be created
   ```
   This creates *devrailsv2 – Bug*, *devrailsv2 – User Story* and *devrailsv2 – UI change* work item templates for that team.
2. **Paste them by hand** into the fields below (switch the field to HTML/markdown or paste as formatted text):

**Bug** — Repro Steps field:
```text
### Summary
### Steps to reproduce
1. Log in as … (role)
2. Open … (page or endpoint)
3. Do …
### Expected behaviour
### Actual behaviour        (exact error message; paste a screenshot)
### Environment             (prod/test/local, app version, browser + OS)
### Logs, request ids or stack traces
```
Acceptance Criteria field: `- Given …, when …, then …`

**User Story** — Description field:
```text
### Problem
### User story              As a …, I want …, so that …
### Out of scope
### Design, examples or screenshots
### Dependencies and open questions
```
Acceptance Criteria field: one `Given …, when …, then …` per line, including error cases.

**UI change** — Description field (tag the item `frontend`):
```text
### Page or component
### Type of change          bug / change / new
### Current state           (screenshot + words)
### Expected result / design (mockup, annotated screenshot or Figma link)
### Steps to reproduce
### Viewports / browsers
### Accessibility
### Out of scope
```
