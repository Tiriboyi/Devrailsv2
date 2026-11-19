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
| **Git hooks** (`.githooks/`) | Commits without an `RFC-<yyyy>-<nnn>:` prefix; staged code without an approved RFC; fast-track changes over the limits |
| **CI gate** (GitHub Actions / Azure Pipelines) | PRs without an approved RFC (approver verified), acceptance criteria without tests, code without tests, missing change record/CHANGELOG |

GitHub Copilot has no equivalent of Claude Code's hooks, so for Copilot the git hooks and the CI gate (with branch protection) are the enforcement.

## Quick start
```bash
# in a new or existing repo
npx github:<you>/devrailsv2 init
```
`init` asks:
1. **Whole repository or one folder** (e.g. only `backend/` of a monorepo, see [Scoping](#scoping-only-part-of-a-repository-under-devrailsv2))
2. **New blank repo, existing repo, or migration** (e.g. Node.js → C#, with the old code's folder)
3. Stack, strictness (light / **standard** / strict), test command
4. **Ticket tracker and how to authenticate**: GitHub (gh CLI or token env var), Azure DevOps (az CLI or PAT env var), both, or none. Change it any time with `devrailsv2 auth`. Tokens are never stored, only the environment variable name.
5. Who may approve RFCs (GitHub usernames and/or git emails), and the default decision owner
6. Whether to connect **Serena** (optional code intelligence)

It then writes the scaffold, vendors itself into `.rails/tool/` (so hooks and CI need no install, including in .NET repos), enables the git hooks and creates `RFC-<yyyy>-000` (already approved) covering the setup itself.

Then:
```bash
git add -A && git commit -m "RFC-2026-000: adopt devrailsv2"
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
| Tiny change (≤ 10 lines) | `devrailsv2 quick "<what you change>"`, then commit and push (see [fast-track](#small-changes-fast-track)) |
| Tokens per RFC / step | `devrailsv2 usage` |
| Is fast-track being misused? | `devrailsv2 audit` |

Inside a repo the CLI is always available as `node .rails/tool/bin/devrailsv2.js`.

Copilot gets the same prompts as `.github/prompts/rails-*.prompt.md`.

## What gets generated
```
AGENTS.md                         main instructions + house rules (managed block; your own text is kept)
CLAUDE.md                         imports AGENTS.md (@AGENTS.md) + Claude specifics
.github/copilot-instructions.md   points Copilot at AGENTS.md
.github/prompts/rails-*.prompt.md Copilot prompt files
.claude/commands/rails-*.md       Claude Code slash commands (each with its model)
.claude/agents/rails-*.md         helper subagents: explorer, test-runner, reviewer
.github/agents/rails-*.agent.md   the same helpers for Copilot
.github/ISSUE_TEMPLATE/           bug, feature and UI issue forms
.claude/settings.json             PreToolUse + SessionStart hooks (merged into existing settings)
.githooks/pre-commit, commit-msg, prepare-commit-msg (adds the RFC id to commit messages)
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

## Scoping: only part of a repository under devrailsv2
In a monorepo you may want the rails on one part, for example the backend, while the UI is worked on normally. `paths.scope` limits devrailsv2 to one or more folders.

### New setup
```bash
devrailsv2 init --scope backend
```
Or answer **no** to *"Apply devrailsv2 to the whole repository?"* and name the folder. `init` then:
- detects the stack **inside the scope folder** (a `backend/*.sln` makes it .NET even if `frontend/package.json` exists);
- prefixes the paths: `backend/src/**`, `backend/tests/**`, `backend/**/*.Tests/**`;
- sets the test command to run there: `cd backend && dotnet test`;
- adds a line to AGENTS.md telling the agent the rules apply only to `backend/`.

### Existing devrailsv2 repo
Edit `.rails/config.json` (in an RFC of its own, since it's tooling), then refresh:
```jsonc
"testCommand": "cd backend && dotnet test",
"paths": {
  "scope": ["backend"],
  "src":   ["backend/src/**"],
  "tests": ["backend/tests/**", "backend/**/*.Tests/**"]
}
```
```bash
devrailsv2 update
```

### Several folders
```jsonc
"paths": {
  "scope": ["backend", "shared/contracts"],
  "src":   ["backend/src/**", "shared/contracts/src/**"],
  "tests": ["backend/tests/**", "shared/contracts/tests/**"]
}
```
A scope entry is a folder (everything below it counts) or a glob (`services/*-api`). If the folders use different test runners, make `testCommand` run them all, e.g. `cd backend && dotnet test && cd ../shared/contracts && npm test`, or point it at a script.

### What is and isn't checked
| | Inside the scope (`backend/`) | Outside (e.g. `frontend/`) |
|---|---|---|
| Claude Code and Serena edits | need an approved, active RFC | free |
| Commit message | must start with `RFC-<yyyy>-<nnn>:` | no prefix needed if the commit only touches files outside the scope |
| Pre-commit and CI gate | full checks (approval, tests, acceptance criteria, change record, fast-track limits) | ignored; listed as "not checked" |
| Change record (`done`) | lists the files | left out |

Always checked, wherever they are: devrailsv2's own files at the repository root (`AGENTS.md`, `CLAUDE.md`, `docs/rfc/`, `docs/changes/`, `.rails/`, `.githooks/`, `.claude/`, the CI workflow). They stay protected from agent edits.

**A change that touches both** (a new endpoint plus the button that calls it) is one RFC. List only the backend files in `affected_areas`; the backend part is gated as usual and the UI part passes through. A pull request that only touches the UI passes CI with a "not checked" note.

**Tips**
- Open Claude Code at the **repository root**, where `.claude/settings.json` and `.mcp.json` live. Opened inside `backend/`, it may not load the root hooks.
- Want the UI under devrailsv2 later? Add `"frontend"` to `scope` with its own `src`/`tests` paths. The RFCs, history and change records carry on.

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

## Small changes: fast-track
A typo, a colour, a version bump: one command, make the change, commit, push. The change is still approved by you, limited in size and recorded, but there is no RFC to write and no separate approval commit.

### The everyday case: tiny changes
```bash
devrailsv2 quick "Change submit button color"      # same as: rfc new "…" --fast-track
#   ✔ Fast-track RFC-2026-014 (micro: ≤ 10 lines, ≤ 3 files in total)
#   Approve it now? [Y/n]  ⏎
#   ✔ Created branch rfc/2026-014-change-submit-button-color
# make the change
git commit -am "change submit button color"         # becomes "RFC-2026-014: change submit button color"
git push                                            # open the PR
```
What happens behind the scenes:
- A complete fast-track RFC is written in the normal RFC format, filled in from the title. Add `--request`, `--outcome` or `--verify` if you want more than the title.
- You confirm with Enter, which records you as the approver (`approved_by`, `approved_on`, a Change History row). You are only asked when you run it yourself in a terminal; an agent can't approve.
- The `rfc/…` branch is created (`--here` stays on the current branch), and the RFC and a CHANGELOG line are **staged**, so they go into the same commit as your change.
- A git hook adds the `RFC-…:` prefix to your commit message.
- No spec, no change record, no `done`.
- **No tests needed** for a micro change, even when it touches a `.ts` or `.cs` file, because its size is capped.

**Micro limits:** the whole change, all files together, at most **10 changed lines** (added + removed, styles included) in at most **3 files**. Lockfiles and [documentation](#documentation-is-always-fast-track) don't count, so `next 16.4.5 → 16.4.6` in `package.json` is one line. Go over the limit and the commit is refused with a message telling you to add `--affects` or use a regular RFC.

### Documentation is always fast-track
Changes to documentation never count towards any fast-track limit: any number of lines, any number of files, anywhere in the repo, no tests, and no protected-area check (a guide about the auth flow is still just a guide). So a docs rewrite is simply:
```bash
devrailsv2 quick "Rewrite the setup guide"     # ⏎ to approve, edit, commit, push
```
In a mixed change, only the code lines count: 300 lines of Markdown plus a 4-line code fix is still a micro change.

What counts as documentation (`paths.docs` in `.rails/config.json`): `*.md`, `*.mdx`, `*.markdown`, `*.rst`, `*.adoc`, `*.txt`, everything under `docs/`, `LICENSE*`, `NOTICE*`.

What looks like documentation but isn't (`paths.docsExclude`), so it still counts:
- **agent instructions**: `AGENTS.md`, `CLAUDE.md`, `.github/**` (Copilot instructions, prompts, workflows), `.claude/**`. They steer the agents, so a big change to them deserves a regular RFC;
- **config that happens to be `.txt`**: `requirements*.txt`, `constraints*.txt`, `CMakeLists.txt`, `robots.txt`, `llms.txt`.

Add your own exceptions to `docsExclude` (e.g. `"**/*.sql.txt"`) or more doc locations to `docs` (e.g. `"wiki/**"`).

### Files that need no RFC at all
Some housekeeping files can always be changed directly, without even a fast-track RFC: `.gitignore` and `.editorconfig`, in any folder. Edit, commit with any message, push; hooks and CI let them through. If the same commit also changes code, the code still needs its RFC.

The list is `paths.noRfc` in `.rails/config.json`. Add files with the same character, e.g. `".prettierignore"`, `".dockerignore"` or `".vscode/extensions.json"`. `.gitattributes` is deliberately not on it: it controls line endings, and the git hooks rely on it.

### Slightly larger: fast-track with a file list
```bash
devrailsv2 quick "Polish invoice page" --affects "src/ui/Invoice.tsx, src/ui/Invoice.module.css"
```
- Up to **200 changed lines** in up to **10 files**, which must be listed exactly. Styles, images and translations don't count towards the lines.
- Edits outside the listed files are blocked.
- Tests are required for anything that isn't cosmetic (styles, images, fonts, translations need none).
- Approval, branch, commit prefix and CHANGELOG work exactly as above.

### When to use which
| Micro (`quick "…"`) | Listed fast-track (`quick "…" --affects …`) | Regular RFC (`rfc new`) |
|---|---|---|
| ≤ 10 lines, ≤ 3 files | ≤ 200 lines, ≤ 10 listed files | anything bigger |
| colours, spacing, wording, typos, a patch-level version bump, a config value, **any documentation change** | a small UI polish, an icon set, a translation batch | new behaviour, business logic, anything you'd want reviewed against acceptance criteria |
| | | **always** for auth, security, permissions, payments, billing, migrations, SQL, CI, infrastructure |

### When an agent does it
An agent may run `quick "…"`. It is treated as a draft: the agent can't approve, because the confirmation only appears in a human's terminal and the hook blocks `--approve` and `rfc approve` for agents. The RFC is staged and waits for you:
```bash
devrailsv2 rfc approve 2026-014     # stages the approval + CHANGELOG line; no separate commit
devrailsv2 rfc start 2026-014
```
In Claude Code you can ask *"draft a fast-track RFC for the button colour"*, approve it, and then let the agent make the change.

### Guards against misuse
The limits are enforced, not suggested.

| Guard | Default | Enforced by |
|---|---|---|
| A **human approves**; agents can't use `--approve` or `rfc approve` | — | Claude hook, interactive check, CI approver check |
| `affected_areas` lists **exact files**: no `**`, no whole folders; a `*` inside one folder is fine (`src/ui/icons/*.svg`) | — | `quick`, `rfc lint`, `rfc approve`, gate |
| **Micro size** (no file list): whole change ≤ 10 lines in ≤ 3 files, every line counted except lockfiles and documentation | `micro: { maxLines: 10, maxFiles: 3 }` | pre-commit, `check`, CI |
| **File limit** (listed fast-track) | `maxFiles: 10` | `quick`, `rfc approve`, gate |
| **Protected areas** never go fast-track (names matched case-insensitively) | `forbidden`: auth, identity, security, permissions, payments, billing, migrations, `*.sql`, CI, infrastructure, devrailsv2 tooling | `quick`, `rfc approve`, Claude hook, pre-commit, CI |
| Edits stay **inside the listed files** (listed fast-track; tests and docs excepted), in every strictness mode | — | Claude hook (blocks the edit), pre-commit, CI |
| **Size cap** (listed fast-track): added + removed lines, not counting styles, assets, docs and lockfiles | `maxLines: 200` | pre-commit (per commit), `check`, CI (whole PR) |
| **One fast-track RFC per pull request**, so a big change can't be stacked from small ones | `onePerPullRequest: true` | CI |
| The approved RFC is **frozen**, so scope can't grow afterwards | — | Claude hook, CI (compares with the approval commit) |
| **Strict mode** turns fast-track off | — | `quick`, gate |

### Watching how it's used
```bash
devrailsv2 audit              # last 90 days; --days 30
```
Shows the share of RFCs that are fast-track, each fast-track RFC's size and approver, and flags:
- more than half of all RFCs being fast-track (`maxShare: 0.5`);
- a fast-track change over the size or file limits, or touching protected areas;
- **possible split work**: three or more fast-track RFCs on the same files within two weeks.

Run it in a weekly scheduled job if several people use the repo.

### Adjusting the limits
All limits live in `.rails/config.json`:
```jsonc
"fastTrack": {
  "maxFiles": 10,
  "maxLines": 200,
  "onePerPullRequest": true,
  "maxShare": 0.5,
  "micro": { "maxLines": 10, "maxFiles": 3 },
  "forbidden": ["**/auth/**", "**/*auth*.*", "**/payment*/**", "**/migrations/**", "**/*.sql", ".github/workflows/**", "…"]
},
"paths": { "cosmetic": ["**/*.css", "**/*.scss", "**/*.svg", "**/*.png", "**/locales/**", "**/*.resx", "…"] }
```
The name matching is broad on purpose: `AuthorList.tsx` counts as "auth", and `billing/` may be a normal area in your project. Trim the list if it blocks too much. Change limits with a regular RFC; if a change hits a limit, the answer is a regular RFC, not a bigger limit.

### Messages you may see
| Message | Meaning / what to do |
|---|---|
| `Micro change is 14 lines … the limit is 10` | Add `--affects` with the files (a new `quick`), or use a regular RFC. |
| `Micro change touches 4 files; the limit is 3` | Same. |
| `affected_areas entry "src/**" uses **` | List the exact files. |
| `"src/auth/…" is in a protected area` | Use `devrailsv2 rfc new` (regular RFC). |
| `… is not listed in fast-track RFC-…` | The agent tried to edit another file. Add it (set the RFC back to draft and re-approve) or use a regular RFC. |
| `Fast-track change is 340 lines … the limit is 200` | Too big for fast-track; use a regular RFC. |
| `Source changed … but no tests changed` | A non-cosmetic file changed: add a test. |
| `only one is allowed per pull request` | Combine the fast-track RFCs, or split the PR. |
| `Fast-track changes are disabled in strict mode` | Strict repos always use regular RFCs. |

Approving with the PR label alone doesn't help locally: the hooks need an approved RFC file before any edit, so the confirmation in `quick` (or `rfc approve`) is the local route.

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
- **strict:** as standard, plus a spec is required, fast-track is off, and edits outside the RFC's `affected_areas` are blocked.

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
  "paths": {
    "scope": ["backend"],                   // optional: only gate these folders (monorepos)
    "src": ["backend/src/**"], "tests": ["backend/tests/**", "backend/**/*.Tests/**"], "legacy": ["legacy/**"],
    "cosmetic": ["**/*.css", "**/*.svg", "**/locales/**"],  // never need tests
    "docs": ["**/*.md", "**/*.txt", "docs/**", "…"],         // always fast-track, never count towards limits
    "docsExclude": ["AGENTS.md", "CLAUDE.md", ".github/**", "**/requirements*.txt", "…"],
    "noRfc": [".gitignore", "**/.gitignore", ".editorconfig", "**/.editorconfig"]   // never need an RFC
  },
  "fastTrack": { "maxFiles": 10, "maxLines": 200, "onePerPullRequest": true, "maxShare": 0.5, "forbidden": ["**/auth/**", "…"] },
  "models": { "enabled": true, "claude": { "ticket": "opus", "implement": "sonnet", "explorer": "haiku" }, "copilot": {} },
  "usage": { "prices": { "opus": { "input": 5, "output": 25 } } },
  "serena": { "enabled": false },
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
