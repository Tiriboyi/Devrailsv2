---
id: RFC-@@key@@
title: Adopt devrailsv2
status: approved
type: fast-track
requested_by: @@userYaml@@
decision_owner: @@userYaml@@
approved_by: @@userYaml@@
approved_on: @@date@@
created: @@date@@
updated: @@date@@
affected_areas: [AGENTS.md, CLAUDE.md, CHANGELOG.md, .gitignore, .gitattributes, .rails/**, .github/**, .claude/**, .githooks/**, docs/**, azure-pipelines.devrailsv2.yml, .serena/**, .mcp.json, .vscode/mcp.json]
test_exemption: tooling setup, no product behaviour change
---

# REQ-@@key@@ - Adopt devrailsv2

## Request

Add the devrailsv2 workflow to this repository: agent instructions, house rules, RFC/spec/change-record templates, Claude Code hooks, git hooks and the pull-request gate.

## Business Reason

Every change from now on starts from an approved Request for Change, is built test-first against acceptance criteria, and leaves a change record behind.

## Current Evidence

Status: `Confirmed`

Claim type: `tooling`

Claim: devrailsv2 was initialised in @@mode@@ mode.

Sources: `.rails/config.json`

Last verified: @@date@@

## Desired Outcome

AI agents and people follow the same RFC → test → change-record flow, enforced by hooks and CI.

## Acceptance Criteria

- [ ] AC-1: `devrailsv2 doctor` passes.
- [ ] AC-2: The first pull request runs the devrailsv2 check.

## Out Of Scope

Any product code change. Those need their own RFC.

## Dependencies And Open Decisions

Protect the main branch and create the PR approval label.

## Verification Plan

Run `devrailsv2 doctor`; open a pull request and confirm the check runs.

## Change History

| Date | Author | Change |
|---|---|---|
| @@date@@ | @@user@@ | Created and approved during setup |
