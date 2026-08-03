# packages

This directory contains all workspace packages managed by `pnpm`.

The workspace is configured with:

- root `pnpm-workspace.yaml` -> `packages/*`
- one package per direct child folder under `packages/`

Use this guide whenever you create a new package.

## 1. Decide Package Scope and Name

Choose a short, descriptive folder name:

- Use `kebab-case`
- Keep names purpose-driven, for example:
  - `network-foundation`
  - `identity-baseline`

The package folder name should match the package name in `package.json` unless there is a strong reason not to.

## 2. Create the Package Folder

From repository root:

```bash
mkdir -p packages/<new-package-name>
```

Example:

```bash
mkdir -p packages/network-foundation
```

## 3. Add `package.json`

Create `packages/<new-package-name>/package.json` with at least:

```json
{
	"name": "<new-package-name>",
	"version": "0.1.0",
	"private": true,
	"description": "Short description of this package",
	"files": [],
	"scripts": {
		"lint": "echo \"No lint configured for <new-package-name>\""
	}
}
```

Guidelines:

- Keep `private: true` unless you explicitly intend to publish.
- Add a clear `description` so package purpose is obvious in tooling.
- Set `files` only if you need to control packaged artifacts.
- Add scripts for validation and checks as soon as practical.

## 4. Add a Package README

Create `packages/<new-package-name>/README.md` and document:

- what the package is for
- what files it contains
- how to validate it
- any required tooling or credentials

Template:

```md
# <new-package-name>

Short purpose statement.

## Contents

- List key files

## Validation

- Explain commands to run

## Notes

- Important assumptions, environments, or constraints
```

## 5. Add Package Assets

Add the package-specific files (for example templates, modules, scripts, or configs).

Example for a CloudFormation-focused package:

- `*.yaml` templates
- helper scripts for validation

## 6. Add Validation Scripts

Expose useful scripts in the package `package.json`.

Example pattern:

```json
{
	"scripts": {
		"lint": "echo \"No lint configured for <new-package-name>\"",
		"validate:one": "<command for first validation>",
		"validate:two": "<command for second validation>",
		"validate": "pnpm run validate:one && pnpm run validate:two"
	}
}
```

Script recommendations:

- Use explicit script names: `validate:<target>`.
- Provide one aggregated `validate` script.
- Keep commands deterministic and CI-friendly.

## 7. Install and Verify Workspace Recognition

From repository root run:

```bash
pnpm install
```

Why: this refreshes lockfile/workspace metadata and confirms the package is detected by `pnpm`.

Optional checks:

```bash
pnpm -r list --depth -1
pnpm --filter <new-package-name> run lint
```

## 8. Run Package Validation

Run package-level checks before opening a PR:

```bash
pnpm --filter <new-package-name> run validate
```

If there is no `validate` script yet, run at least:

```bash
pnpm --filter <new-package-name> run lint
```

## 9. Update Root Documentation (If Needed)

If the new package introduces a major capability, update root docs to make it discoverable:

- repository `README.md`
- architecture or onboarding docs

## 10. Pull Request Checklist

Before merge, confirm:

- folder is under `packages/<new-package-name>`
- `package.json` exists and is valid JSON
- package `README.md` exists and explains usage/validation
- validation scripts run locally
- root docs are updated when relevant

## Example: Minimal New Package

```text
packages/
  network-foundation/
    package.json
    README.md
    template.yaml
```

Minimal `package.json` example:

```json
{
	"name": "network-foundation",
	"version": "0.1.0",
	"private": true,
	"description": "Network baseline templates",
	"files": ["*.yaml"],
	"scripts": {
		"lint": "echo \"No lint configured for network-foundation\"",
		"validate": "aws cloudformation validate-template --template-body file://template.yaml"
	}
}
```

## Common Mistakes to Avoid

- Creating nested packages (workspace only includes direct children in `packages/*`).
- Forgetting `private: true` for internal-only packages.
- Missing package-level `README.md` and validation scripts.
- Using vague names that do not describe package responsibility.
