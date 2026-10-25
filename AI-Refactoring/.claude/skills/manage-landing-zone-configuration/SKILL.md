---
name: manage-landing-zone-configuration
description: >-
  Use when adding, changing, reviewing, or troubleshooting repository configuration in config/*.yaml,
  config/schemas, environment selection, ccoe-config-reader usage, or Zod validation. Applies to
  Staging and Production configuration in this AWS ESC Landing Zone repository.
---

# Manage Landing Zone Configuration

This skill owns the shared workflow and conventions for repository YAML configuration, schema validation, and configuration loading. Domain skills remain authoritative for the meaning and allowed values of their own fields.

## Configuration Ownership

- `config/default.yaml` contains values shared by Staging and Production.
- `config/staging.yaml` and `config/production.yaml` contain environment-specific values and overrides.
- A key in `default.yaml` is merged into both environments. Do not place a Staging-only value there.
- Production validation must not depend on generated IDs that are unavailable before deployment.
- `config/schemas/` contains the Zod schemas that define and validate configuration. Extend the owning schema; do not create a parallel loader or validation framework.
- Treat configuration and schemas as desired state. Do not duplicate configurable values as TypeScript constants or infer customer-provided values from account names, OUs, or other metadata.
- Never add credentials, tokens, passwords, or secrets to YAML, schemas, tests, or generated configuration output. Use only approved secret references where needed.
- Never invent or persist generated AWS account, Organization, Root, OU, Identity Center, group, or permission-set identifiers. Keep approved management-account inputs distinct from IDs generated at runtime.

Before editing a field, identify its owning domain skill and preserve that skill's field-level requirements. Do not use this skill to decide new policy, identity, account, or Control Tower values.

## Config Reader

Use the pinned `@ccoe-aws_if-it/ccoe-config-reader` package. Do not modify its source or replace it with another loader.

The TypeScript API is:

```ts
new ConfigReader(environment, {
  configDirName: 'config',
  schema: LandingZoneSchema
}).getConfig();
```

This uses the default `configRoot` (`process.cwd()`) and `defaultConfigName` (`default`).

Use the repository's actual exported schema instead of the illustrative `LandingZoneSchema` name above when working in another domain. The Zod schema is applied to the merged result and may transform it; use the returned inferred type.

Reader behavior to account for:

- It loads `default` and the requested environment config, then deep-merges them in that order; environment scalar values override defaults.
- Arrays merge default entries followed by environment entries, removing duplicate values.
- For extensionless names, resolution order is `.js`, `.cjs`, `.mjs`, `.yaml`, `.yml`. Explicit supported extensions are used directly.
- Default options are `configRoot: process.cwd()`, `configDirName: 'etc'`, `defaultConfigName: 'default'`, and `verbose: false`; repository calls normally set `configDirName: 'config'`.
- A missing config file or a file-load error can become an empty object. Ensure required values are rejected by the Zod schema or an explicit validation gate rather than relying on file loading to fail closed.

The CLI is `ccoe-config-reader <environment>` and supports `--configRoot`, `--configDirName`, `--defaultConfigName`, `--verbose`, `--pretty`, and `--output`/`-o`. The CLI does not accept a Zod schema; use the TypeScript API or a separate schema-backed validation path when validation is required. Do not treat CLI JSON extraction alone as proof that configuration is valid.

## Schema and Change Workflow

1. Identify the domain skill and approved source for each new or changed value.
2. Decide whether the value is shared or environment-specific. Remember that defaults reach both environments.
3. Extend the owning Zod schema and its inferred types. Validate formats, allowed values, requiredness, cross-field relationships, and environment completeness there where practical.
4. Update only the relevant YAML files. Do not add values to both environment files when they are genuinely shared, and do not use defaults to conceal missing required customer inputs.
5. Add or update tests for valid and invalid configuration, including both environments and any merge-sensitive arrays or required overrides.
6. Run focused schema/config tests, then the repository's required build, type-check, lint, tests, and Staging/Production synthesis or validators for the affected domain.
7. Review the resulting changes for secrets, generated identifiers, unintended environment inheritance, unvalidated CLI-only reads, and duplicated sources of truth.

Configuration validation and synthesis are local checks. Do not deploy, bootstrap, invoke AWS mutation APIs, or trigger deployment workflows as part of this skill.