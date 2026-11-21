## Code intelligence: CodeSlice
This repository has CodeSlice connected as an MCP server. It analyzes the solution with Roslyn and answers questions about structure and the impact of a change. It works the answer out, so don't rebuild it from file reads.

**Use it first, before Grep and before reading whole files:**
- **Before proposing or making a change, call `analyze_change_impact`** with the types or members you plan to change. It returns:
  - direct and transitive dependents
  - affected projects
  - the tests that reach the change
  - risks (cycles, rule violations, health)
  - a ready-to-paste `affected_areas` list
  - evidence lines
- Use its `affected_areas` list as the RFC's `affected_areas`. Add transitive dependents only if their code must change too.
- Copy its evidence lines into ticket analyses and RFCs. They count as `Confirmed`. Claims you did not check are `Likely` or `Unclear`.
- `get_blast_radius` lists who depends on a type, grouped by project, plus implementers and subclasses.
- `find_symbol` locates types and members. `get_type_overview` describes a type: members, signatures, complexity and dependencies. `get_symbol_slice` returns the source of one type or method.
- Dependencies are tracked per type, so naming a member gives the dependents of its whole type.
- The graph refreshes by itself when `.cs`/`.csproj` files change. Call `refresh_graph` after deleting or moving files.

CodeSlice only reads. Make edits with the normal editor tools; they need an approved, active RFC as usual. Serena is not used in this repository, and the devrailsv2 hook blocks its editing tools.
