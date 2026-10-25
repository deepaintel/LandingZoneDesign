---
description: 'Repository-wide safety and workflow rules for aws-sc-landing-zone'
applyTo: '**/*'
---

# AWS ESC Landing Zone Global Rules

- This repository implements the AWS European Sovereign Cloud Landing Zone with CDK and TypeScript. Use partition `aws-eusc` and Region `eusc-de-east-1`; do not introduce commercial AWS defaults.
- Treat configuration and schemas as the source of desired state. Never invent or persist generated AWS account, Organization, Root, or OU IDs.
- Keep independently deployable CloudFormation stacks decoupled: do not use Exports/`Fn::ImportValue`, CDK cross-stack references, or `addDependency` to pass runtime values or impose deployment order. Pass runtime values through workflow-populated CloudFormation parameters; ordinary non-exported outputs may be read by workflows. Do not pass another stack's constructs, tokens, outputs, resource attributes, or `attr*` values into a stack.
- Every new stack needs tests or offline template validation proving prohibited cross-stack coupling is absent. Any exception requires an explicit approved design decision.
- Do not deploy, bootstrap, invoke AWS mutation APIs, trigger deployment workflows, or perform Git write operations while authoring or reviewing. Use non-deploying local validation only.
- Preserve the protected release flow: `main` is CI-only; Staging deploys before Production; Production requires its protected GitHub Environment approval and uses the same release commit.
- Consult the relevant on-demand skill for specialized work. Skills are the active home for domain workflows and constraints. During the archive migration, consult an archived reference only when the relevant skill points to one; do not maintain duplicate guidance after it has migrated.
- Agent customization is authored in `.apm/`; never hand-edit generated instruction/agent files. After changing APM sources, run `apm compile` and `apm audit --ci`. Follow `.apm/skills/manage-apm-customization/SKILL.md` for the full authoring workflow.