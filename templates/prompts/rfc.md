Draft a Request for Change for: @@ARGS@@

1. Read `docs/STATUS.md`, `AGENTS.md` (section *Writing an RFC*) and any analysis for this work in `docs/analysis/`.
2. Run `@@cli@@ rfc new "<short title>" --ticket <ref> --affects "<comma-separated globs>"`. Use `--fast-track` only for typos, docs-only changes, config tweaks or dependency bumps.
3. Fill in every section of the generated file, keeping the format exactly:
   - frontmatter: `title`, `requested_by`, `decision_owner`, `affected_areas`; leave `status: draft`, `approved_by: null`, `approved_on: null`;
   - affected_areas: if Serena is connected, derive them from the files that define and reference the symbols you will change (`find_referencing_symbols`);
   - Current Evidence: `Status` is Confirmed, Likely, Unclear, Missing or Contradiction; cite real sources and today's date; only use Confirmed for what you verified;
   - Acceptance Criteria: `- [ ] AC-1: Given …, when …, then …`, one observable behaviour each, including error cases;
   - Out Of Scope, Dependencies And Open Decisions, Verification Plan.
4. If tests genuinely cannot apply, add `test_exemption: <reason>` to the frontmatter; the user decides whether to accept it.
5. Run `@@cli@@ rfc lint <id>` and fix everything it reports.
6. Reply with a short summary of the RFC (id, outcome, acceptance criteria, open decisions) and stop until the user approves it.
