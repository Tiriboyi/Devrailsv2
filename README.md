# devrailsv2

Spec-driven, test-first guardrails for AI coding agents (Claude Code and GitHub Copilot), built so that **nothing changes without an approved Request for Change**, every change is proven by tests linked to acceptance criteria, and every change leaves documentation behind.

Zero dependencies. Node 18.17+. Works in Node, .NET and mixed repos.

```
Ticket ─▶ Analysis ─▶ RFC (draft, AC-1…n) ─▶ human approval ─▶ optional spec
   ─▶ failing tests ─▶ implementation ─▶ refactor ─▶ change record + docs ─▶ PR ─▶ CI gate
```

## Why it's more than an AGENTS.md
Instructions guide an agent; they don't stop it. devrailsv2 writes the instructions **and** enforces them in three places:

| Layer | What it blocks |
|---|---|
| **Claude Code hooks** (`.claude/settings.json`) | Edits (built-in tools and Serena's MCP edit tools) without an approved, active RFC; self-approval (`status`, `approved_by`, `approved_on`, `rfc approve`, approval label); editing an approved RFC; `--no-verify`; editing hooks, config or CI |
| **Git hooks** (`.githooks/`) | Commits without an `RFC-NNNN:` prefix; staged code without an approved RFC |
| **CI gate** (GitHub Actions / Azure Pipelines) | PRs without an approved RFC (approver verified), acceptance criteria without tests, code without tests, missing change record/CHANGELOG |

GitHub Copilot has no equivalent of Claude Code's hooks, so for Copilot the git hooks and the CI gate (with branch protection) are the enforcement.

## Quick start
```bash
# in a new or existing repo
npx github:<you>/devrailsv2 init
```
`init` asks:
1. **New blank repo, existing repo, or migration** (e.g. Node.js → C#, with the old code's folder)
2. Stack, strictness (light / **standard** / strict), test command
3. **Ticket tracker and how to authenticate**: GitHub (gh CLI or token env var), Azure DevOps (az CLI or PAT env var), both, or none. Change it any time with `devrailsv2 auth`. Tokens are never stored, only the environment variable name.
4. Who may approve RFCs (GitHub usernames and/or git emails)

It then writes the scaffold, vendors itself into `.rails/tool/` (so hooks and CI need no install, including in .NET repos), enables the git hooks and creates `RFC-0000` covering the setup itself.

Then:
```bash
git add -A && git commit -m "RFC-0000: adopt devrailsv2"
```
On GitHub: protect `main` (require pull requests and the **devrailsv2** status check) and create the `rfc-approved` label. On Azure Repos: add `azure-pipelines.devrailsv2.yml` as a build-validation policy.

## Day to day
| You / the agent | Command (or Claude Code slash command) |
|---|---|
| Fetch and analyse a ticket (with screenshots) | `devrailsv2 ticket gh:42` → `/rails-ticket gh:42` |
| Check a ticket is complete | `devrailsv2 ticket lint gh:42` |
| Draft the Request for Change | `devrailsv2 rfc new "Export invoices" --ticket GH#42 --affects "src/billing/**"` → `/rails-rfc` |
| Check its format | `devrailsv2 rfc lint 1` |
| **Approve (you only)** | `devrailsv2 rfc approve 1` (interactive) or the `rfc-approved` PR label |
| Start | `devrailsv2 rfc start 1` (creates branch `rfc/2026-001-export-invoices`) |
| Optional spec (required in strict) | `devrailsv2 spec new` → `/rails-spec 1` |
| Red → green → refactor | `/rails-implement 1` — tests reference `RFC-2026-001:AC-1` |
| Change record, CHANGELOG, STATUS | `devrailsv2 done --run-tests` → `/rails-done` |
| Gate | `devrailsv2 check` |
| Where are we? | `devrailsv2 status` → `/rails-status` |

Inside a repo the CLI is always available as `node .rails/tool/bin/devrailsv2.js`.

Copilot gets the same prompts as `.github/prompts/rails-*.prompt.md`.

## What gets generated
```
AGENTS.md                         main instructions + house rules (managed block; your own text is kept)
CLAUDE.md                         imports AGENTS.md (@AGENTS.md) + Claude specifics
.github/copilot-instructions.md   points Copilot at AGENTS.md
.github/prompts/rails-*.prompt.md Copilot prompt files
.claude/commands/rails-*.md       Claude Code slash commands
.claude/settings.json             PreToolUse + SessionStart hooks (merged into existing settings)
.githooks/pre-commit, commit-msg
.github/workflows/devrailsv2.yml  PR gate + tests
.github/pull_request_template.md
.rails/config.json                mode, stack, strictness, paths, tracker, approvers
.rails/tool/                      vendored CLI
docs/STATUS.md                    where we are / next step / where we came from
docs/rfc/  docs/specs/  docs/changes/  docs/adr/  docs/analysis/
docs/guides/spec-guidelines.md    how to write acceptance criteria + TDD rules
docs/guides/workflow.md           the flow and what enforces what
docs/migration/                   (migration mode) evidence map + parity matrix
CHANGELOG.md
```

## Models per step (token budget)
Each step runs on the model that fits it, and bulky work goes to small helper subagents, so the main conversation stays short.

| Step | Default (Claude Code) | Why |
|---|---|---|
| `/rails-ticket`, `/rails-rfc`, `/rails-spec` | opus | mistakes here are the most expensive |
| `/rails-implement`, `/rails-done` | sonnet | most of the edits; the RFC already fixes what to do |
| `/rails-status` | haiku | summarising |
| `rails-explorer` subagent | haiku | code search and impact; returns a short report with file:line evidence (read-only) |
| `rails-test-runner` subagent | haiku | runs tests / `devrailsv2 check`; returns failures only (never edits) |
| `rails-reviewer` subagent | opus | independent read-only review against the RFC before the PR |

```bash
devrailsv2 models                         # show the routing
devrailsv2 models set implement opus      # haiku | sonnet | opus | inherit
devrailsv2 models set explorer --copilot "Fast model (copilot), Fallback (copilot)"
devrailsv2 models off | on | reset
```
- **Claude Code:** `model:` in `.claude/commands/rails-*.md` and the subagents in `.claude/agents/`.
- **Copilot (VS Code):** `model:` in `.github/prompts/rails-*.prompt.md` and custom agents in `.github/agents/rails-*.agent.md`. Copilot model names depend on your plan, so they start empty (the model picker decides) until you set them, using the names exactly as the picker shows them.
- AGENTS.md tells the agent to delegate searching and test runs to the subagents. The devrailsv2 hooks apply to subagents too, and agents cannot edit the command or agent files.
- Switching models mid-conversation loses the prompt cache. Subagents avoid this because each starts with a small, fresh context. A fresh session per RFC keeps costs down too.

## Measuring token usage
```bash
devrailsv2 usage                 # last 30 days    (--days 0 = all time, --rfc 1, --json)
```
Reads Claude Code's own session logs on this machine (`~/.claude/projects/<repo>/…`); nothing is sent anywhere. It reports:
- totals: requests, input / output / cache-write / cache-read tokens, **cache hit rate**, estimated cost;
- **by RFC** (from the `rfc/<yyyy>-<nnn>-…` branch active at the time, marked `[fast]` for fast-track);
- **by step** (`/rails-ticket`, `/rails-implement`, … and each subagent, e.g. `subagent: rails-explorer`);
- **by model**;
- **fixed overhead**: the measured context a new session starts with, the size of AGENTS.md and its largest sections, and connected MCP servers;
- hints: low cache hit rate, sessions spanning several RFCs, sessions over 120k tokens, too little delegation, an oversized AGENTS.md.

Costs are list-price estimates; set your own in `.rails/config.json` → `usage.prices` (`{"opus": {"input": 5, "output": 25}, …}`, USD per million tokens). GitHub Copilot doesn't expose token counts; see premium requests in your GitHub billing settings. For dashboards across repos, Claude Code can also export the `claude_code.token.usage` and `claude_code.cost.usage` metrics via OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`).

## Small changes: `quick`
A cosmetic fix shouldn't need a full RFC, but it should still be approved and recorded.
```bash
devrailsv2 quick "Fix save button padding on mobile" --affects src/ui/Button.module.css \
  --request "Save button touches the screen edge on mobile" \
  --outcome "12 px padding on viewports < 768 px" \
  --verify "Checked at 375 px in Chrome and Safari; existing tests pass" --approve
# make the change, then
devrailsv2 done --run-tests && git push   # open the PR
```
- Writes a **fast-track RFC in the full RFC format**. The sections that don't apply are pre-filled, so only Request, Desired Outcome and Verification Plan need writing; `rfc lint` checks only those three for fast-track.
- `--approve` (a human, in a terminal) approves it, creates the `rfc/<id>-…` branch and commits the approval under your name in one step. Agents can run `quick` without `--approve`. The hook blocks the flag for them, and the RFC then waits for `rfc approve`.
- **No tests for cosmetic files.** Changes that only touch `paths.cosmetic` (styles, images, icons, fonts, translations; editable in `.rails/config.json`) pass the gate without tests. Touch anything else and tests are required again, so logic can't slip in as "cosmetic".
- No spec; acceptance criteria are optional; `done` writes a short change record.
- Strict mode disables fast-track.
- Batching: several small fixes can share one fast-track RFC if every file is in `affected_areas`.
### Keeping fast-track honest
Fast-track is only useful if it stays small, so the limits are enforced, not just suggested. They live in `.rails/config.json` → `fastTrack`.

| Guard | Where it's enforced |
|---|---|
| A **human approves** every fast-track RFC; agents can't (`--approve` and `rfc approve` are blocked for them) | Claude hook, interactive check, CI approver check |
| `affected_areas` must list **exact files**: no `**`, no whole folders (a `*` inside one folder is fine), at most `maxFiles` (10) | `quick`, `rfc lint`, `rfc approve`, gate |
| **Protected areas** never go fast-track: auth/identity/security/permissions, payments/billing, migrations and SQL, CI workflows, infrastructure (Terraform, Bicep, Docker), devrailsv2's own tooling (`fastTrack.forbidden`) | `quick`, `rfc approve`, Claude hook, pre-commit, CI |
| Edits stay **inside the listed files** (tests and docs excepted), in every strictness mode | Claude hook (blocks the edit), pre-commit, CI |
| **Size cap**: `maxLines` (200) added + removed lines, not counting styles, assets, docs and lockfiles | pre-commit (per commit), `check`, CI (whole PR) |
| **Logic needs tests**: only cosmetic files (`paths.cosmetic`) may change without them | gate |
| **One fast-track RFC per pull request** (`onePerPullRequest`), so a big change can't be stacked from small ones | CI |
| The approved RFC is **frozen**, so scope can't grow afterwards | Claude hook, CI (compares with the approval commit) |
| **Visibility**: `devrailsv2 audit [--days 90]` shows the fast-track share, the size of each fast-track RFC, protected files touched, and *possible split work* (several fast-track RFCs on the same files within two weeks) | on demand / in a scheduled job |

If a change hits a limit, the answer is a regular RFC, not a bigger limit. Raise limits only per repository, with an RFC of its own.

- Approving via the PR label alone doesn't help locally: the hooks need an approved RFC file before any edit. `--approve` is the quick local route.

## The RFC format
`docs/rfc/RFC-<yyyy>-<nnn>-<slug>.md`, numbered per year (`RFC-2026-001`, `RFC-2026-002`…). Any command accepts `RFC-2026-001`, `2026-001` or just `1`.

```markdown
---
id: RFC-2026-001
title: Export invoices
status: draft            # draft | approved | rejected | superseded — set by humans only
type: change             # change | fast-track
requested_by: Anna
decision_owner: Product Owner
approved_by: null        # set by `rfc approve`
approved_on: null
created: 2026-10-22
updated: 2026-10-22
affected_areas: [src/billing/**, tests/billing/**]
# test_exemption: <reason>   (optional, for the approver to accept)
---

# REQ-2026-001 - Export invoices
## Request · ## Business Reason · ## Current Evidence · ## Desired Outcome
## Acceptance Criteria      - [ ] AC-1: Given …, when …, then …
## Out Of Scope · ## Dependencies And Open Decisions · ## Verification Plan · ## Change History
```
- `rfc lint` checks the frontmatter keys, the required sections, evidence status (`Confirmed | Likely | Unclear | Missing | Contradiction`), numbered acceptance criteria and unfilled `<placeholders>`.
- `rfc approve` sets `status`, `approved_by`, `approved_on`, `updated` and adds a Change History row. `done --run-tests` ticks the criteria whose tests pass and adds an "Implemented" row.
- Once approved, an RFC is frozen. The Claude hook blocks edits (only reverting to `status: draft` is allowed), and CI fails if the content changed after the approval commit. Ticked boxes, `updated` and Change History rows don't count as changes.

## Tickets the agent can work with
A ticket is the agent's only view of what's wanted, so devrailsv2 helps on both ends:
- **Templates.** `init` writes GitHub issue forms (`.github/ISSUE_TEMPLATE/`: Bug report, Feature request, UI / frontend change). For Azure DevOps, `devrailsv2 ticket templates --azure --team "<team>"` creates matching work item templates. `docs/guides/ticket-format.md` explains what a complete ticket contains and how to make useful screenshots.
- **Readiness check.** `ticket <id>` and `ticket lint <id>` detect the ticket type (bug / feature / UI) and check the required parts: steps, expected and actual behaviour and environment for bugs; user story and acceptance criteria for features; page, current state, expected design, a screenshot or design link, viewports and acceptance criteria for UI. Missing parts become questions for the requester, and the agent is told not to guess.
- **Screenshots.** Images in the ticket body, comments, the Azure DevOps fields and image attachments are downloaded (up to 12, 10 MB each) to `.rails/runtime/tickets/<id>/`, which is git-ignored (`--keep-assets` puts them in `docs/analysis/assets/` instead). The analysis lists the files, and the agent must open each one and describe what it shows before analysing. Your GitHub or Azure DevOps credentials are sent only to those hosts. Redirects are followed by hand, so a token never travels to another site.

## Serena (optional code intelligence)
[Serena](https://github.com/oraios/serena) gives agents symbol-level tools (find symbol, find references, diagnostics, symbol edits) through MCP. devrailsv2 connects it and gates it.

```bash
uv tool install -p 3.13 serena-agent && serena init     # once per machine
devrailsv2 init --serena                                  # new repo, or:
devrailsv2 serena enable                                  # existing devrailsv2 repo
```

What `serena enable` sets up:
| File | Purpose |
|---|---|
| `.mcp.json` | Claude Code: `serena start-mcp-server --context=claude-code --project-from-cwd --agent-interface tools` |
| `.vscode/mcp.json` | GitHub Copilot agent mode in VS Code: `--context=vscode --project ${workspaceFolder} --agent-interface tools` |
| `.serena/project.yml` | language servers for your stack (TypeScript, C#, both for migrations), `agent_interface: tools`, `excluded_tools: [serena_repl, execute_shell_command, remove_project]`, an `initial_prompt` pointing at AGENTS.md |
| `.claude/settings.json` | Serena's own `serena-hooks activate / remind / cleanup` (not `auto-approve`) |
| `AGENTS.md` | rules: navigate with Serena, cite symbols as RFC evidence, derive `affected_areas` from references; memories are a cache, not the source of truth |

**How it's gated.** Serena edits files through its own MCP tools, which Claude's built-in `Edit`/`Write` checks never see. So the devrailsv2 hook matches `mcp__.*serena.*` too:
- read tools (`find_symbol`, `find_referencing_symbols`, `get_diagnostics_for_file`, …) and memories: always allowed
- `replace_symbol_body`, `insert_*_symbol`, `replace_content`, `safe_delete_symbol`: same rule as `Edit` on that file (approved, active RFC; scope in strict mode)
- `rename_symbol`, `replace_in_files`: need an approved, active RFC; repo-wide `replace_in_files` and anything touching `docs/rfc/` or tooling is refused; CI checks the final scope
- `serena_repl`, `remove_project`: blocked; `execute_shell_command`: same rules as Bash (and excluded in `project.yml`)

**Why `--agent-interface tools` matters.** Serena 2.x defaults to a REPL interface where the agent gets a single `serena_repl` tool that runs Python. Edits made that way are invisible to any hook, so devrailsv2 always forces the one-tool-per-operation interface, both in the launch command and in `project.yml`. `devrailsv2 doctor` checks it.

## Approval
Approval can come from either the RFC file or a PR label (configurable in `.rails/config.json` → `approval.require`):

| `require` | Meaning |
|---|---|
| `either` (default) | `status: approved` set in a commit authored by an approver (content unchanged since), **or** the PR label added by an approver |
| `both` | both are required |
| `label` | only the PR label counts (most tamper-resistant: GitHub records who added it) |
| `file` | only the RFC file counts (use for Azure Repos) |

Note on the file route: agents commit with *your* git identity, so CI can't tell your commit from theirs. The hooks stop Claude from writing the approval, but if you want approval that cannot be forged by any tool running on your machine, use `label` or `both`.

## Strictness
- **light:** approval enforced; tests, spec and docs only warn.
- **standard:** approval, tests, acceptance-criteria coverage and change records enforced; fast-track RFCs allowed; scope only warns.
- **strict:** no fast-track; edits outside the RFC's `Affects:` paths are blocked.

## Distribution
### 1. Run straight from GitHub (no publishing)
Push this folder to a GitHub repo, then anywhere:
```bash
npx github:<you>/devrailsv2 init
```
For a private repo, the machine needs git access to it (SSH key or `gh auth login`).

### 2. Private npm package
npmjs.com private packages and GitHub Packages both require a scope. Rename and publish:
```jsonc
// package.json
"name": "@<you>/devrailsv2",
"publishConfig": { "registry": "https://npm.pkg.github.com" }   // for GitHub Packages
```
```bash
npm publish
# consumers (.npmrc): @<you>:registry=https://npm.pkg.github.com
npx @<you>/devrailsv2 init
```

### 3. Template repository
Create an empty repo, run `npx github:<you>/devrailsv2 init --mode new`, commit, and tick **Settings → Template repository**. New repos created from it start with the rails in place; run `node .rails/tool/bin/devrailsv2.js auth` in each to set the tracker.

### Updating a repo
```bash
npx github:<you>/devrailsv2@latest update     # or: node .rails/tool/bin/devrailsv2.js update
```
`update` re-vendors the CLI and refreshes tool-owned files and managed blocks; user-owned files (STATUS, PR template, workflow) are kept.

## Configuration (`.rails/config.json`)
```jsonc
{
  "mode": "existing",                       // new | existing | migration
  "stack": "dotnet",                        // node | dotnet | other
  "migration": { "from": "node", "to": "dotnet", "legacyPath": "legacy" },
  "strictness": "standard",
  "testCommand": "dotnet test",
  "paths": { "src": ["src/**"], "tests": ["tests/**", "**/*.Tests/**"], "legacy": ["legacy/**"] },
  "tracker": {
    "provider": "both", "default": "github",
    "github": { "repo": "me/app", "auth": "gh-cli", "tokenEnv": "GITHUB_TOKEN" },
    "azure":  { "org": "myorg", "project": "App", "auth": "pat-env", "patEnv": "AZURE_DEVOPS_PAT" }
  },
  "approval": { "require": "either", "prLabel": "rfc-approved", "approvers": ["me", "me@example.com"] }
}
```
GitHub Enterprise / Azure DevOps Server: set `tracker.github.apiUrl` / `tracker.azure.baseUrl`.

## Limits worth knowing
- Hooks inspect tool calls; a determined agent could still write files through an unusual shell command. CI plus branch protection is the backstop that can't be bypassed locally.
- Acceptance-criteria coverage checks that a test *references* each criterion, not that the test is good. Review the red tests; they're the cheapest place to catch a misunderstanding.

## Developing devrailsv2
```bash
npm test     # node:test, no dependencies
```
