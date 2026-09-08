---
description: AWS Landing Zone CloudFormation and CDK stack coupling rules
applyTo: '**/*'
---

# AWS Landing Zone CloudFormation Governance

These rules apply to every CDK and CloudFormation stack in `aws-sc-landing-zone`.

## Stack Coupling

Stacks in this repository must not use CloudFormation Exports, `Fn::ImportValue`, or CDK cross-stack references for runtime values.

Values shared between independently deployable stacks must be passed through deployment-time CloudFormation parameters populated by the deployment workflow. Stack outputs may remain ordinary, non-exported outputs for workflow discovery.

Do not use CDK `addDependency` between independently deployable stacks unless the approved design explicitly requires it. Workflow ordering must be used where one stack must be deployed before another.

Do not pass one stack's construct instance, generated resource attribute, `CfnOutput`, or `attr*` token into another independently deployable stack.

## Validation

Every new stack must have tests or offline template validation proving that prohibited cross-stack exports, imports, or runtime coupling are absent. Any exception requires an explicit approved design decision.
