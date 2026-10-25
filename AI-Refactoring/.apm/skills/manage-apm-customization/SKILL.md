---
name: manage-apm-customization
description: >-
  Use when creating, editing, reviewing, troubleshooting, or validating APM-managed agent
  customization in this repository, including instructions, skills, prompts, apm.yml,
  generated outputs, or APM compile/audit behavior.
---

# Manage APM Customization

This skill defines the repository workflow for authoring AI agent customization with Microsoft APM. `.apm/` is the single source of truth; generated agent files are build output.

## Source Layout

- Instructions live in `.apm/instructions/*.instructions.md`.
- Skills live in `.apm/skills/<skill-name>/SKILL.md`.
- Prompts, if used, live in the corresponding `.apm/` source location.
- `apm.yml` declares deployment targets and `includes: auto`, which discovers APM sources automatically.
- Do not create or edit generated files directly. Generated outputs include `.github/instructions/*.instructions.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `.claude/rules/*.md`, and platform-deployed skill copies.

Manual edits to generated outputs can be overwritten by compilation and cause `apm audit --ci` drift failures. Make changes in `.apm/` sources and let APM generate the outputs.

## Authoring Workflow

1. Choose the correct primitive and scope: always-on repository rules belong in instructions; specialized, on-demand workflows belong in skills; use prompts only for focused parameterized tasks.
2. Add or update the source under `.apm/`. Keep descriptions specific enough for agents to discover on-demand skills, and use repository naming/frontmatter conventions.
3. Avoid duplicating domain guidance across skills. Link to the active owning skill when it is the canonical source, while retaining any critical constraints needed locally because skills load on demand.
4. Run `apm compile` to regenerate distributed outputs.
5. Run `apm audit --ci` to verify generated outputs, package/lock consistency, and deployment state.
6. Review the source and generated diff together. APM output should reflect `.apm/` content without unrelated generated changes.

Do not bypass drift checks by editing generated output to match. During authoring/review, do not perform Git write operations; leave commit/push actions to the separately approved workflow.

## Validation and Troubleshooting

- If `apm compile` changes an unexpectedly large generated file, inspect current `.apm/` inputs and the generated diff before proceeding. Preserve unrelated user changes.
- If `apm audit --ci` reports drift, run the repository's approved APM synchronization workflow, then rerun the audit.
- If package/deployment ownership conflicts or an APM source is replaced by a different package, inspect `apm.yml`, `apm.lock.yaml`, and deployment sources rather than editing generated files.
- Do not upgrade the APM CLI or change targets/dependencies as part of an unrelated customization edit.

## Completion Criteria

An APM customization change is ready for review when the `.apm/` source is correct, generated outputs are synchronized, `apm audit --ci` passes, and no unrelated generated or user changes were overwritten.
