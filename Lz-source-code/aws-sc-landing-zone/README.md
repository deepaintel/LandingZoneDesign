# aws-sc-landing-zone

Infrastructure as Code for the **AWS European Sovereign Cloud (AWS ESC)** Landing Zone, implemented with
**AWS CDK v2 and TypeScript**.

## Project overview

This repository is the implementation repository for the AWS ESC Landing Zone. It contains CDK application
code, environment configuration, automated tests, validation scripts, and GitHub Actions workflows.

The project is developed incrementally through approved implementation phases. The current infrastructure
includes the AWS Organizations OU foundation. Additional Landing Zone capabilities are introduced through
separate, approved phases.

Platform defaults:

| Property        | Value                             |
| --------------- | --------------------------------- |
| AWS partition   | `aws-eusc`                        |
| AWS Region      | `eusc-de-east-1`                  |
| ARN prefix      | `arn:aws-eusc:`                   |
| STS endpoint    | `sts.eusc-de-east-1.amazonaws.eu` |
| Package manager | `pnpm`                            |
| Test runner     | `vitest`                          |

## Repository structure

| Path                 | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `bin/`               | CDK application entry points                      |
| `config/`            | Environment configuration and validation schemas  |
| `lib/`               | CDK stacks and reusable constructs                |
| `scripts/`           | Offline and runtime validation utilities          |
| `tests/`             | Unit and CDK assertion tests                      |
| `.github/workflows/` | CI and deployment workflows                       |
| `.github/actions/`   | Repository-owned composite actions                |
| `.apm/instructions/` | Authoritative cross-agent governance instructions |
| `.apm/skills/`       | Task-specific AI agent workflows                  |

## Development

Install dependencies and run the standard checks:

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run validate
```

Synthesize a selected environment locally:

```bash
npx cdk synth -c environment=staging
npx cdk synth -c environment=production
```

Local validation is intended to be offline. Do not deploy, bootstrap, or use long-lived AWS credentials from
local development commands.

## Configuration

The CDK application uses one codebase for the supported environments. Select the environment with CDK
context or the repository's documented environment variable fallback.

Shared configuration belongs in `config/default.yaml`; environment-specific values belong in the matching
environment file. Configuration is loaded and validated through the repository's typed schemas.

## Branches and deployment

The repository follows a protected-release model:

```text
feature/* or hotfix/* -> main -> release/* -> Staging -> manual Production
```

`main` is the integration branch and is CI-only. Protected `release/*` branches are the deployment source.
Corrections to an existing release are merged to `main`, selectively promoted through a temporary
`backport/*` branch, and merged into `release/*` through the required pull-request controls.

GitHub Actions uses short-lived OIDC credentials for automated AWS deployment. Human workforce access and
automated deployment access are separate concerns and are governed by their respective approved designs.

IAM Identity Center runtime identifiers are discovered only by authenticated deployment workflows and passed
to the CDK stack as deployment parameters. Microsoft Entra ID federation uses SAML 2.0. SCIM provisioning
and temporary privileged-access membership are owned by Foundation and Entra/PAM processes, not this
repository's IaC.

Before the first Identity Center deployment in an AWS Organization, an authorized operator must enable the
IAM Identity Center organization instance once through the AWS Console. The deployment workflow does not
create `AWS::SSO::Instance`; it discovers exactly one active organization instance with
`aws sso-admin list-instances` and fails closed when none is available.

The current IAM Identity Center baseline declares the approved Permission Set catalogue and its provisional
AWS-managed policy attachments. Group mappings and account assignments wait for SCIM-provisioned groups and
approved environment account scopes; no standing Production access is declared in this repository.

## Control Tower initialization prerequisites

The `CreateLandingZone` API path this repository uses requires the following one-time setup in
the management account before the `initialize-control-tower` composite action can succeed. The
Console-based Control Tower flow provisions these automatically; the API-based flow does not.

- **AWS Organizations trusted access** for `controltower.amazonaws.com`,
  `member.org.stacksets.cloudformation.amazonaws.com`, `config.amazonaws.com`, and
  `config-multiaccountsetup.amazonaws.com`. Enabled idempotently by the
  `.github/scripts/enable-org-trusted-access.sh` script, invoked by the `initialize-control-tower`
  composite action. Enabling `controltower` also auto-provisions the service-linked role
  `AWSServiceRoleForAWSControlTower`.
- **Management-account prerequisite IAM roles** (`AWSControlTowerAdmin`,
  `AWSControlTowerCloudTrailRole`, `AWSControlTowerStackSetRole`) provisioned by the
  `lz-control-tower-roles` CDK stack (`ControlTowerRolesStack`, deployed by the
  `deploy-control-tower-roles` composite action).

Pre-init validation asserts both prerequisites and fails fast with actionable errors when
missing. See `.apm/instructions/control-tower-initialization.instructions.md` §6.1 and §11.1
for the authoritative details, including why this is an approved exception to the general
"do not pre-create Control Tower roles" rule (which continues to apply to member-account roles
such as `AWSControlTowerExecution`).

## Documentation authority

Use the following sources for detailed guidance:

- `.apm/instructions/` contains durable repository governance, architecture constraints, and safety rules.
- `.apm/skills/` contains task-specific implementation and validation procedures for AI agents.
- Approved design documents contain the target architecture and unresolved decisions.
- Source code and tests define the behavior that is currently implemented.

Generated agent files are outputs, not authoring sources. Update the relevant `.apm/` source and regenerate
model-specific files with APM rather than editing generated files directly.

## Current status

Before implementing a new Landing Zone capability, confirm its approved scope, external dependencies, AWS ESC
service support, configuration contract, tests, validation strategy, and deployment impact in the applicable
APM instruction and skill files.
