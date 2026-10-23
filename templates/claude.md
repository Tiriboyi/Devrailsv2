<!-- devrailsv2:start -->
@AGENTS.md

## Claude Code specifics
- `AGENTS.md` (imported above) is the main instruction file. Follow it exactly.
- Hooks in `.claude/settings.json` run devrailsv2 before every edit and shell command. They block code changes without an approved RFC, changes to an RFC's `status`/`approved_by`/`approved_on`, edits to approved RFCs, skipping git hooks, and edits to tooling. When a hook blocks you, read its message, follow the workflow, and tell the user. Do not look for a way around it.
- At session start a hook gives you the active RFC and the next step.
- Slash commands: `/rails-ticket`, `/rails-rfc`, `/rails-spec`, `/rails-implement`, `/rails-done`, `/rails-status`.
- Use plan mode for anything larger than a few files, and present the plan before writing tests.
<!-- devrailsv2:end -->
