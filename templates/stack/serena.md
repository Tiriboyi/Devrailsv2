## Code intelligence: Serena
This repository has [Serena](https://github.com/oraios/serena) connected as an MCP server (semantic, symbol-level tools backed by language servers).

**Use it for understanding code:**
- Start with `get_symbols_overview` and `find_symbol` instead of reading whole files.
- Use `find_referencing_symbols` / `find_implementations` to find impact before you propose a change.
- In ticket analyses and RFCs, cite symbols as evidence, e.g. `InvoiceService/Total in src/billing/InvoiceService.cs (3 callers: …)`. Evidence you checked with Serena may be `Confirmed`; unchecked claims are `Likely` or `Unclear`.
- Propose `affected_areas` from the files that define and reference the symbols you will change.
- Before `devrailsv2 done`, check `get_diagnostics_for_file` on every changed file.

**Editing with Serena follows the same rules as any edit.** devrailsv2's hook checks Serena's editing tools (`replace_symbol_body`, `insert_*_symbol`, `replace_content`, `rename_symbol`, `safe_delete_symbol`, `replace_in_files`, …): they need an approved, active RFC, cannot touch `docs/rfc/` or tooling, and respect `affected_areas` in strict mode.
- `rename_symbol` and `replace_in_files` change every reference. Run `find_referencing_symbols` first and make sure all of those files are within the RFC's `affected_areas`; CI checks the final scope.
- Edit RFCs with the normal editor tools, never with Serena.
- `execute_shell_command`, `serena_repl` and `remove_project` are disabled.

**Memories:** Serena memories (`.serena/memories/`) are a convenience cache for navigation hints. The source of truth is `docs/STATUS.md`, the RFCs, ADRs and change records. Never record decisions, approvals or requirements only in a memory.
