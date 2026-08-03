# identity-provider

AWS CDK package for the GitHub Actions identity provider stack.

## Contents

- `bin/identity-provider.ts` CDK app entrypoint
- `lib/identity-provider-stack.ts` stack definition for the GitHub OIDC provider and federated IAM role
- `cdk.json` default CDK app config and GitHub repository context

## Configuration

The stack reads GitHub trust settings from environment variables first and falls back to CDK context values in `cdk.json`.

- `GITHUB_ORG`
- `GITHUB_REPO`
- `GITHUB_BRANCH`

Default context values currently target the `topdanmark/if-github-emu` repository and the `main` branch.

## Validation

From the repository root:

```bash
pnpm install
pnpm --filter identity-provider run validate
```

Useful package commands:

```bash
pnpm --filter identity-provider run synth
pnpm --filter identity-provider run diff
pnpm --filter identity-provider run deploy
```

## Notes

- The IAM role trust policy is restricted to one repository branch by default.
- The CDK stack is the only active deployment artifact for this package.
