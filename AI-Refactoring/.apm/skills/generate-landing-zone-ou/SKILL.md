---
name: generate-landing-zone-ou
description: Plan, generate, and locally validate only the first AWS ESC Landing Zone implementation increment: the approved AWS Organizations OU hierarchy through L3, using the revised main/release/backport GitOps model, foundation-provided composite actions, ccoe-config-reader v1.1.0 with a Zod schema for load-time validation, and the prepare-organization composite action for deploy-time Root ID resolution.
disable-model-invocation: true
---

# Generate AWS ESC Landing Zone OU

This skill is intentionally limited to the first implementation phase of `aws-sc-landing-zone`.

Implement and validate only the AWS Organizations OU hierarchy.

Do not implement SCPs, accounts, StackSets, IAM, KMS, logging, security baselines, tagging, networking, shared services, or workload baselines.

This skill contains the active OU-generation workflow and its applicable technical and GitOps constraints. It does not authorize work on other Landing Zone components.

## Supported Commands

```text
/generate-landing-zone-ou inspect
/generate-landing-zone-ou inspect-foundation
/generate-landing-zone-ou inspect-config-reader
/generate-landing-zone-ou plan
/generate-landing-zone-ou scaffold
/generate-landing-zone-ou implement-config
/generate-landing-zone-ou implement-ou
/generate-landing-zone-ou implement-prepare-organization
/generate-landing-zone-ou implement-ci
/generate-landing-zone-ou implement-staging-deployment
/generate-landing-zone-ou implement-production-workflow
/generate-landing-zone-ou validate
/generate-landing-zone-ou report
```

This skill covers the OU hierarchy, its configuration, and the release workflow. SCP, account, and Control Tower work use their own skills.

## Mandatory References

Read:

1. Approved OU hierarchy and OU diagram.
2. Approved GitOps CI/CD and branch-promotion design.
3. Approved bootstrap/deployment-integration design.
4. Approved IAM design only for OIDC/deployment-role alignment.
5. Copied foundation workflows/composite actions/bootstrap implementation.
6. The installed ccoe-config-reader package interface and the shared `.apm/skills/manage-landing-zone-configuration/SKILL.md` for loader and schema conventions.
7. Current `aws-sc-landing-zone`.
8. `README.md`.

`../landing-zone-design` is read-only.

If references conflict, stop and report the conflict.

## Branching and Release

Follow `.apm/skills/manage-landing-zone-release-workflows/SKILL.md` for the complete branch, release, promotion, and post-Production lifecycle. For this OU phase, CI is non-deploying, `release/*` is the only deployment source, Staging precedes Production, and the OU stack deploys before downstream stacks.

Required configs/workflows:

```text
config/default.yaml
config/staging.yaml
config/production.yaml
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/validate-and-deploy.yml
.github/actions/prepare-organization/action.yaml
```

## Workflow Ownership

`aws-sc-landing-zone` owns the CI and release workflows and the prepare-organization composite action. Consume approved foundation composite actions for ESC OIDC credentials/common setup. Follow `.apm/skills/manage-landing-zone-configuration/SKILL.md` for shared reader/schema conventions; this OU skill owns the OU-specific configuration contract. Do not modify ccoe-config-reader.

### OU Deployment Composite Action Boundary

The calling workflow owns release triggers, job ordering, environment selection, permissions, OIDC setup, Production approval, and workflow-level summaries. The local OU deployment action owns only the cohesive OU-stack mechanics:

- accept `aws-environment`, `account-id`, `aws-region`, and `organization-root-id` as explicit inputs;
- run `cdk diff` and `cdk deploy` only for `OuStructureStack` (`lz-ou-structure`);
- perform the associated post-deployment validation: exactly 14 OUs, valid OU ID patterns, the five approved top-level OUs under the resolved Root, and only `AWS::Organizations::OrganizationalUnit` resources;
- expose OU IDs/outputs needed by downstream stack deployments;
- do not configure credentials, branch on literal environment names, deploy another stack, or introduce cross-stack exports/imports.

The workflow deploys the OU stack before downstream stacks. Production approval remains at the protected GitHub Environment and occurs before Production validation or OIDC authentication.

## OU Configuration Contract

Follow `.apm/skills/manage-landing-zone-configuration/SKILL.md` for common file ownership, merge, reader, and schema mechanics. For this OU phase:

- `config/default.yaml` owns the shared `aws.partition`, `aws.region`, and complete 14-entry OU hierarchy as slash-delimited paths.
- `config/staging.yaml` and `config/production.yaml` own their respective `aws.accountId` values; do not place a Root ID in configuration.
- `config/schemas/organization-schema.ts` exports `LandingZoneSchema`; its transform derives stable OU keys and parent references from the validated hierarchy.
- `prepare-organization` resolves the Organization and Root IDs at deployment time; the Root ID flows to the OU stack as a CloudFormation parameter.
- ccoe-config-reader is a generic loader and carries no Landing Zone configuration.

## Mode: inspect

Read-only. Report:

- repository tree;
- existing CDK/TypeScript files;
- existing configs (`config/default.yaml`, `config/staging.yaml`, `config/production.yaml`, `config/schemas/organization-schema.ts`)/tests/workflows/scripts;
- package manager / Node / CDK versions;
- ccoe-config-reader version pinned in `package.json` (must be v1.1.0 or later for schema support);
- missing OU-phase files (including the composite action);
- unresolved design inputs.

Do not modify files.

## Mode: inspect-foundation

Read-only. Identify:

- exact credentials composite-action path;
- `action.yml`/`action.yaml`;
- action inputs/outputs/defaults;
- repository/tag/commit reference;
- deployment-role input (aws-role-name);
- ESC STS endpoint handling;
- GitHub permissions;
- Node/CDK/package-manager conventions;
- action pinning;
- bootstrap qualifier/synthesizer convention;
- readiness/smoke validation.

Do not invent interfaces.

## Mode: inspect-config-reader

Read-only. Follow the reader inspection checklist in `.apm/skills/manage-landing-zone-configuration/SKILL.md`; additionally verify the installed package version and confirm it supports the OU implementation's `schema: LandingZoneSchema` API and required CLI invocation. The reader must remain a generic loader with no project-specific configuration files. Report any mismatch; do not modify the dependency as part of this mode.

## Mode: plan

Read-only. Produce an OU-only plan with:

1. confirmed 14-OU hierarchy;
2. references used (including reader interface with `schema` option);
3. foundation integration findings;
4. reader integration findings and version to pin (v1.1.0 or later);
5. repository assessment;
6. exact files to create/modify (including the composite action, `config/default.yaml`, and `config/schemas/organization-schema.ts`);
7. Root ID handling (composite action, CFN parameter);
8. management account ID handling (`config/<env>.yaml`, merged with `default.yaml`, reader with `schema: LandingZoneSchema`);
9. Zod schema design (path validation, sibling uniqueness, depth, exact-14 count, key derivation, transform to normalized `OrganizationConfig`);
10. OU construct/stack design (thin construct, hierarchy resolution inside the stack);
11. tests;
12. CI;
13. release-based Staging deployment;
14. protected Production GitHub Environment approval in the merged release workflow;
15. GitHub Environment inputs (secrets only — no identifier variables);
16. unresolved placeholders/risks.

End with:

`Waiting for explicit approval before creating or modifying files.`

## Mode: scaffold

After approval, create/align only the OU-phase functional structure:

```text
bin/landing-zone.ts
config/default.yaml
config/staging.yaml
config/production.yaml
config/schemas/organization-schema.ts
lib/constructs/organizational-unit.ts
lib/organization/ou-structure-stack.ts
tests/ou-structure-stack.test.ts
scripts/validate-ou-template.ts
.github/actions/prepare-organization/action.yaml
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/validate-and-deploy.yml
package.json
approved lockfile
pnpm-workspace.yaml
tsconfig.json
tsconfig.test.json
cdk.json
vitest.config.ts
eslint.config.mjs
```

Configuration validation lives in the Zod schema at `config/schemas/organization-schema.ts` and runs when the reader loads the configuration.

Future directories may exist empty, but do not generate functional future-component code.

## Mode: implement-config

Generate only OU-phase configuration support.

Requirements:

- strong typing (types inferred from the Zod schema — `LandingZoneConfig`, `OrganizationConfig`);
- strict validation inside the schema (partition, region, 12-digit accountId, OU path validity, sibling uniqueness, maximum depth, exactly 14 OUs, key derivation);
- `aws.partition: aws-eusc` (declared in `config/default.yaml`);
- `aws.region: eusc-de-east-1` (declared in `config/default.yaml`);
- `aws.accountId` declared per environment as a quoted 12-digit string in `config/staging.yaml` and `config/production.yaml`;
- OU hierarchy declared once in `config/default.yaml` as slash-delimited paths under `organization.organizationalUnits[].name`;
- no Root ID stored anywhere (resolved at deploy time by the composite action);
- no AWS access keys, secret access keys, IAM user credentials, or bearer tokens;
- no invented role ARNs;
- both environments validate; Production deploys after protected GitHub Environment approval.

Loading:

- Use `@ccoe-aws_if-it/ccoe-config-reader` (v1.1.0 or later) as a generic loader against the local `config/` directory with `configDirName: 'config'` and `schema: LandingZoneSchema`. The reader itself performs the Zod validation and returns the normalized, strongly typed configuration object.

## Mode: implement-ou

Implement exactly:

```text
Root (managed by the prepare-organization composite action)
├── Security
├── Infrastructure
├── Sandbox
├── Suspended
└── Workloads
    ├── Hybrid
    │   ├── Prod
    │   └── Non-Prod
    ├── Online
    │   ├── Prod
    │   └── Non-Prod
    └── Corp
        ├── Prod
        └── Non-Prod
```

Total: 14 OUs.

Requirements:

- CDK v2 TypeScript;
- strict TypeScript;
- `aws-cdk-lib/aws-organizations`;
- Root ID accepted as a CloudFormation parameter (`OrganizationRootId`, pattern-constrained `^r-[0-9a-z]{4,32}$`), fed at deployment time by the prepare-organization composite action's output;
- management account ID read from the merged configuration (`default.yaml` + `<env>.yaml`) via the reader with `schema: LandingZoneSchema`;
- OU stack consumes the normalized `OrganizationConfig` from the schema and resolves keys, parents, levels, hierarchy paths, and parent-before-child ordering locally;
- unique OU keys (derived by the schema);
- repeated display names allowed under different parents (sibling uniqueness enforced by the schema);
- hierarchy validation happens inside the Zod schema, NOT inside the construct;
- OU construct is a thin wrapper over `CfnOrganizationalUnit` — no input validation;
- no direct AWS SDK discovery in CDK code;
- no AWS-requiring CDK context lookups;
- exactly 14 `AWS::Organizations::OrganizationalUnit`;
- zero `AWS::Organizations::Account`;
- zero `AWS::Organizations::Policy`.
- stack name is the constant `lz-ou-structure` set in `bin/landing-zone.ts`, not read from configuration.

Do not implement anything else. Do not create the AWS Organization or the Root from CDK code.

## Mode: implement-prepare-organization

Generate .github/actions/prepare-organization/action.yaml.

Requirements:

- composite action (`runs.using: composite`);
- input `expected-account-id` (12-digit string, required);
- optional input `aws-region` (default `eusc-de-east-1`);
- outputs `organization-id` and `organization-root-id`;
- assert `sts:GetCallerIdentity` returns `expected-account-id` before any Organizations call;
- call `aws organizations describe-organization`; if the Organization exists, no side effect;
- on `AWSOrganizationsNotInUseException`, call `aws organizations create-organization --feature-set ALL`;
- resolve Organization ID and Root ID via `describe-organization` and `list-roots` with a retry loop for eventual consistency;
- validate both IDs against their regex patterns before emitting outputs;
- log both identifiers to `$GITHUB_STEP_SUMMARY` on every run;
- idempotent — safe to re-invoke on every deploy;
- no destructive Organizations calls.

## Mode: implement-ci

Generate `.github/workflows/ci.yml`.

CI only. No OIDC deployment credentials, bootstrap, or deployment.

Validate:

- build/typecheck/lint/tests;
- CDK synth for staging (`-o cdk.out/staging`) and production (`-o cdk.out/production`);
- exact 14 OUs via `pnpm run validate:ou-template -- --environment <env> --output-dir cdk.out/<env>`;
- zero Accounts;
- zero Policies;
- ESC partition/region checks in source;
- deployment-authority YAML checks on the workflow files;
- approved security/secrets checks.

Support relevant feature/hotfix/main/backport PR validation under the approved branch model.

## Mode: implement-staging-deployment

Use `.github/workflows/deploy.yml` and `.github/workflows/validate-and-deploy.yml` after confirming the foundation composite-action interface and the reader CLI shape (including `--configDirName`).

Requirements:

- owned by `aws-sc-landing-zone`;
- consumes approved foundation composite action for AWS credentials (OIDC);
- consumes the repository-local prepare-organization composite action at `./.github/actions/prepare-organization`;
- source is protected `release/*`;
- initial controlled release creation triggers first Staging deploy;
- approved backport PR merge triggers Staging redeploy;
- no main/feature/hotfix/backport direct deployment;
- reads `aws.accountId` by invoking the ccoe-config-reader CLI against the repository's own `config/` directory (`--configDirName config`);
- passes the resolved account ID to `aws-credentials`;
- invokes `prepare-organization` after credentials are configured, passing the same account ID as `expected-account-id`;
- passes the composite's `organization-root-id` output to `cdk deploy --parameters "OrganizationRootId=<id>"`;
- no GitHub Environment variables for account ID or Root ID;
- uses `config/default.yaml` + `config/staging.yaml` for landing-zone architecture (merge performed by the reader);
- GitHub Environment `staging`;
- OIDC (`id-token: write`) only in deployment job;
- deploys the OU Structure stack before downstream approved stacks (stack ID `OuStructureStack`, stack name `lz-ou-structure`);
- post-deployment OU validation using the same `organization-root-id`;
- no bootstrap;
- no long-lived credentials.

## Mode: implement-production-workflow

Use the Production invocation in the same release workflow. Do not recreate a separate Production workflow or execute a deployment during code generation.

Requirements:

- approved protected `release/*` push and the same Staging-validated commit;
- uses `config/default.yaml` + `config/production.yaml` for landing-zone architecture;
- reads `aws.accountId` via the reader CLI against the repository's own `config/` directory;
- resolves Root ID via the prepare-organization composite action;
- passes `organization-root-id` to `cdk deploy --parameters`;
- protected `production` GitHub Environment with required reviewers;
- starts only after protected `production` GitHub Environment approval;
- only after Production succeeds: idempotent tag, GitHub Release with generated notes for that tag, then release-branch deletion guarded by the released commit SHA, all with `GITHUB_TOKEN` and job-level `contents: write`, implemented by the `tag-release`, `publish-github-release`, and `retire-release-branch` composite actions;
- foundation composite action for AWS credentials (OIDC);
- no independent Production trigger from `main`, feature, hotfix, or backport;
- no feature/hotfix/backport deployment;
- no bootstrap;
- no long-lived credentials.

## Mode: validate

After approval, validate:

```text
<package-manager> install
<package-manager> run build
<package-manager> run typecheck
<package-manager> run lint
<package-manager> test
npx cdk synth -c environment=staging -o cdk.out/staging
npx cdk synth -c environment=production -o cdk.out/production
<package-manager> exec tsx scripts/validate-ou-template.ts --environment staging --output-dir cdk.out/staging
<package-manager> exec tsx scripts/validate-ou-template.ts --environment production --output-dir cdk.out/production
<package-manager> run validate:ou-template:production
git status
git diff
```

Verify:

- exactly 14 OUs;
- zero Accounts;
- zero Policies;
- no commercial partition/STS assumptions;
- no Root ID literals in source or in synthesized templates (Root ID enters only as CFN parameter);
- `aws.accountId` present in both `config/staging.yaml` and `config/production.yaml`;
- shared configuration (partition, region, OU list) present only in `config/default.yaml`;
- no shared configuration duplicated inside `config/staging.yaml` or `config/production.yaml`;
- CI does not deploy;
- `main` does not deploy;
- `backport/*` does not deploy;
- only `release/*` is deployment source;
- Staging uses `config/default.yaml` + `config/staging.yaml`;
- Production uses the protected GitHub Environment approval after Staging succeeds;
- foundation composite action is used;
- prepare-organization composite action exists at `.github/actions/prepare-organization/action.yaml`;
- `@ccoe-aws_if-it/ccoe-config-reader` is a dependency (v1.1.0 or later), not modified by this project;
- no GitHub Environment variables carry `accountId` or `rootId`;
- no bootstrap;
- no long-lived credentials.

Never execute deployment workflows locally.

## Mode: report

Report:

- references inspected (including reader interface with `schema` option);
- files created/modified (including composite action, `config/default.yaml`, `config/schemas/organization-schema.ts`);
- foundation action path/reference;
- reader package version pinned (v1.1.0 or later);
- composite action outputs (`organization-id`, `organization-root-id`);
- OU count/resource types;
- Root ID handling (composite action → CFN parameter, never stored);
- management account ID handling (`config/<env>.yaml`, loaded via reader with `schema: LandingZoneSchema`);
- build/lint/typecheck/test/synth/validate-ou-template results;
- CI and Staging triggers;
- Production approval boundary (protected GitHub Environment before OIDC);
- confirmation that only OU infrastructure was implemented;
- confirmation that no SCP/account/StackSet/IAM/KMS/logging/tagging code was generated;
- confirmation that the CDK application does not create the AWS Organization or the Root;
- confirmation that the reader is used as a library only, unchanged by this work;
- confirmation that Zod is the single source of configuration validation;
- confirmation that the OU construct performs no input validation;
- confirmation that `main` is CI-only;
- confirmation that `release/*` is the only deployment source;
- confirmation that `backport/*` never deploys;
- confirmation that Production was not deployed;
- confirmation that no GitHub Environment variable holds `accountId` or `rootId`;
- confirmation that no local AWS deployment or Git write occurred.

After reporting OU completion, STOP and wait for explicit instruction before the next Landing Zone component.

## Prohibited Actions

Never:

- edit `../landing-zone-design`;
- modify ccoe-config-reader source (use it as a library only);
- run AWS CLI;
- run `cdk deploy` or `npx cdk deploy`;
- run `cdk bootstrap` or `npx cdk bootstrap`;
- commit/push/merge/rebase/create PR;
- execute GitHub workflows;
- access secrets/credentials;
- store AWS access keys, secret access keys, or bearer tokens in this repository;
- store the Organizations Root ID in any source-controlled file;
- introduce GitHub Environment variables carrying `accountId` or `rootId`;
- perform AWS deployment.
