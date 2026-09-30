---
description: 'AWS Lambda implementation guardrails for the aws-sc-landing-zone repository'
applyTo: '**/*'
---

# AWS Lambda Implementation Instructions

## 1. Purpose

This instruction defines how AWS Lambda functions should be implemented, configured, and managed within the aws-sc-landing-zone repository.

## 2. Scope

This instruction applies to all AWS Lambda functions developed and maintained within the aws-sc-landing-zone repository. It covers aspects such as runtime selection, configuration, security, networking, environment management, error handling, logging, packaging, testing, deployment, and exit criteria.

## 3. Runtime and Language Requirements

- Implement Lambda functions in TypeScript.
- Use strict TypeScript settings and include Lambda source files in type-checking and linting.
- Use Node.js 24.x runtime for all Lambda functions.
- Use the repository's standard esbuild-based bundling through CDK Node.js Lambda constructs.
- Keep Lambda runtime code under `src/functions/`.
- Keep CDK resources, Lambda constructs, and Step Functions definitions under `lib/`.
- Use AWS SDK v3 clients for AWS service calls.
- Use ESM modules. Preserve the repository's `package.json` `type: module`, `NodeNext` module settings, and `.js` extensions in relative TypeScript imports.
- Do not place CDK constructs, CloudFormation tokens, or deployment-time configuration in Lambda runtime modules.
- Keep handlers thin: validate and transform the event, orchestrate the use case, and return the workflow payload. Put AWS SDK access in service or adapter helpers.

## 4. AWS European Sovereign Cloud Requirements

- Use the configured AWS ESC Region supplied through environment or deployment configuration.
- Do not hard-code commercial AWS Regions, partitions, or service endpoints.
- Read the runtime Region from configuration or an environment variable such as `REGION`.
- Use partition-aware ARN construction when ARNs are required.
- Do not hard-code AWS account IDs, Organization IDs, OU IDs, or other generated identifiers.
- Use the `aws-eusc` partition and `eusc-de-east-1` Region when values must be explicit.
- Treat account IDs, OU IDs, Identity Center IDs, group IDs, and permission-set ARNs as runtime or deployment inputs, not source-code constants.
- Validate that account IDs are exactly 12 numeric digits before sending them to AWS APIs.

## 5. Function Configuration

- Create SDK clients once per execution environment, outside the handler, so Lambda can reuse connections across invocations.
- Configure AWS SDK v3 clients with the repository standard retry settings:
	- `retryMode: 'standard'`
	- `maxAttempts: 10`
- Keep client creation and command execution inside service adapters such as the organization, Identity Center SSO, and Identity Store helpers.
- Expose domain-level helper methods to handlers instead of exposing SDK clients, commands, or SDK response shapes.
- Pass a Powertools `Tracer` to client factories and wrap SDK v3 clients with `tracer.captureAWSv3Client(...)`.
- Use explicit Lambda timeout, memory, reserved concurrency, and retry settings in the owning CDK construct. Align Step Functions task retries and catches with the function's failure contract.
- Do not mutate workflow event state unless the workflow contract explicitly requires it. Prefer immutable transformations when building the next state.

## 6. IAM and Permissions

- Grant each Lambda only the AWS API permissions required by its adapter operations.
- Keep IAM policies in the CDK infrastructure layer, not in handler code.
- Use read-only permissions for discovery functions.
- Do not grant wildcard service permissions or broad administrative permissions to a discovery or synchronization function.
- Keep human Identity Center access separate from non-human Lambda and GitHub Actions identities.
- Do not use long-lived credentials in Lambda code, environment variables, test fixtures, or deployment packages.

## 7. Networking

- Do not place a Lambda in a VPC unless it requires access to private resources.
- If VPC access is required, define subnets, security groups, DNS, and egress explicitly in CDK.
- Confirm that a VPC-connected function can reach required AWS ESC service endpoints.
- Prefer regional AWS service integrations and avoid hard-coded commercial endpoints.

## 8. Environment Variables and Secrets

- Use environment variables only for non-secret runtime configuration and approved secret references.
- Use `REGION` for the configured AWS Region when the SDK client requires an explicit region.
- Never store access keys, secret keys, bearer tokens, or passwords in source, configuration, tests, or Lambda environment defaults.
- Retrieve secrets through an approved secret-management service and validate decoded secret objects with a Zod schema before use.
- Do not log secret values or complete sensitive workflow events.
- Validate required environment variables before making AWS API calls where the value is not supplied by the AWS runtime.

## 9. Error Handling and Retries

- Use AWS SDK v3 standard retry behavior for throttling and transient AWS service failures. Do not add a second generic exponential-backoff layer around SDK calls.
- Use targeted application-level retries only for documented eventual-consistency or state-transition behavior that the SDK cannot classify.
- Use AWS SDK paginators for every paginated API. Aggregate page items directly; do not assume one API response contains the complete result set.
- Treat missing required AWS identifiers as errors. Never replace missing account IDs, group IDs, request IDs, or ARNs with fabricated placeholder values.
- Validate adapter responses before constructing downstream AWS commands.
- Preserve the original error and stack when wrapping errors by using the `cause` property.
- Fail closed on malformed events, unknown status values, missing permission-set mappings, invalid account scopes, and incomplete AWS responses.
- Let unhandled failures propagate to Lambda and Step Functions after structured logging so configured retry and catch policies can operate.
- Do not convert missing assignment status into `IN_PROGRESS` unless that behavior is explicitly part of the AWS service contract.

## 10. Logging and Observability

- Use AWS Lambda Powertools for TypeScript Logger and Tracer.
- Create Logger and Tracer instances outside the handler and use a stable service name per function.
- Use the shared Powertools/Middy handler factory where available. Keep middleware ordering consistent:
	1. Parser input validation
	2. Input validation error propagation
	3. Workflow correlation ID binding
	4. Response validation
	5. Tracer Lambda-handler capture
	6. Logger Lambda-context injection
- Bind the workflow `correlationId` explicitly to the Powertools Logger when the event contains one.
- Use `tracer.captureAWSv3Client` for every AWS SDK v3 client.
- Keep full event logging disabled by default. Do not use `logEvent: true` for workflow events that contain account, group, ARN, or permission-set data.
- Log selected operational fields such as correlation IDs, resource identifiers where permitted, result counts, and operation names.
- Pass native `Error` objects to `logger.error` when available so message and stack information are preserved; stringify unknown thrown values only as a fallback.
- Configure buffered logging deliberately and document any repository-specific environment switch such as `POWERTOOLS_LOGGER_BUFFERING`.
- Use `flushBufferOnUncaughtError: true` when log buffering is enabled.
- Do not log credentials, secrets, complete account objects, or complete workflow payloads by default.

## 11. Packaging and Dependencies

- Bundle each Lambda entry point independently with esbuild through the CDK Node.js Lambda construct.
- Keep runtime dependencies in `dependencies` and CDK/build/test-only packages in `devDependencies`.
- Declare every runtime package imported by `src/functions` directly in `package.json`; do not rely on transitive dependencies.
- Keep AWS SDK commands and client dependencies inside adapters when possible so handlers depend on domain contracts.
- Keep shared runtime schemas, middleware, logger setup, and adapter utilities under `src/functions/`.
- Exclude `dist/`, `cdk.out/`, coverage output, and package-manager stores from source control.
- Confirm that ESM bundling targets the selected Lambda Node.js runtime and preserves compatible import behavior.

## 12. Testing Requirements

- Include `src/**/*.ts` in production and test TypeScript projects.
- Include `src/**/*.test.ts` in Vitest configuration.
- Place tests beside the Lambda or helper they cover.
- Mock adapter contracts or helper modules in handler tests. Test AWS SDK behavior in dedicated adapter/helper tests.
- Test successful, empty, paginated, malformed, and AWS-failure paths.
- Test account-ID, ARN, group-ID, request-ID, and permission-set validation failures.
- Test cross-field workflow invariants, including account scope membership and permission-set mapping availability.
- Test that terminal workflow states do not require or emit fabricated request IDs.
- Test Powertools client instrumentation and SDK retry configuration in adapter tests.
- Test that correlation IDs are attached to logs and that full event logging is not enabled by default.
- Do not call AWS services, Organizations APIs, Identity Center APIs, or Control Tower APIs from local unit tests.
- Run build, type-check, lint, formatting, unit tests, and non-deploying CDK/template validation before reporting completion.

## 13. Deployment Model

- Define Lambda functions, IAM roles, environment variables, and event sources in CDK under `lib/`.
- Define Step Functions state machines and Lambda task integrations in `lib/`.
- Reference handler entry points under `src/functions/` from CDK Node.js Lambda constructs.
- Configure Step Functions retry, catch, timeout, and terminal-state transitions explicitly.
- Keep independently deployable stacks decoupled according to the repository CloudFormation governance rules.
- Do not use runtime cross-stack references, CloudFormation exports, or imports for Lambda or state-machine configuration.
- Do not deploy, bootstrap, or invoke AWS mutation APIs as part of local validation.
- Use the approved protected release workflow for deployment; do not deploy Lambda changes directly from feature, hotfix, main, or backport branches.

## 14. Security and Safety

- Treat all account, organization, OU, Identity Center, group, and permission-set data as sensitive operational data.
- Validate external SCIM group names before translating them into account assignments or Permission Set mappings.
- Do not trust a group account scope unless it is a valid account ID or a valid OU ID resolved through the Organizations adapter.
- Do not create assignments for accounts outside the discovered and authorized account scope.
- Do not silently skip malformed authorization data without structured logging and an auditable reason.
- Keep Production privileged access pipeline-first, time-bound, and subject to the approved Identity Center governance model.
- Do not use Lambda handlers to create long-lived human access, IAM users, access keys, or standing privileged Production assignments.
- Keep deployment and human workforce identities separate.
- Do not add broad IAM permissions, broad account assignments, or broad retry exemptions as a workaround for implementation failures.

## 15. Exit Criteria

A Lambda implementation is complete when:

- The handler is implemented under `src/functions/` and uses ESM-compatible TypeScript.
- Its CDK resource, IAM policy, and optional Step Functions integration are implemented under `lib/`.
- Its entry point bundles successfully with esbuild for the selected Node.js runtime.
- `src` is included in production and test type-checking.
- Unit tests cover success, empty, paginated, invalid, and AWS-failure cases.
- Input and output schemas are strict where appropriate and derived types do not drift from Zod contracts.
- Required AWS identifiers and cross-field workflow relationships are validated.
- SDK clients are isolated in adapters/helpers, configured with standard retries, and instrumented with Powertools Tracer.
- Powertools Logger, Parser, and Tracer middleware are configured through the shared handler pattern.
- Full event logging is disabled by default and correlation IDs are preserved.
- Errors retain useful identity, stack, and cause information.
- IAM permissions are least-privileged and no credentials or fabricated identifiers are present.
- Build, type-check, lint, formatting, tests, and non-deploying CDK validation pass.
- No AWS deployment, bootstrap, Control Tower initialization, or live Organizations mutation occurred during local validation.
