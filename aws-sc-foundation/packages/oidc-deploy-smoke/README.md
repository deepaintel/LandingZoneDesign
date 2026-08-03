# oidc-deploy-smoke

Minimal AWS CDK package used to verify deployment through GitHub Actions with OIDC credentials from the identity provider role.

## Contents

- `bin/oidc-deploy-smoke.ts` CDK app entrypoint
- `lib/oidc-deploy-smoke-stack.ts` minimal stack

## Validation

From repository root:

```bash
pnpm install
pnpm --filter oidc-deploy-smoke run validate
```

## Deploy Through GitHub Actions

Use workflow `04-oidc-deploy-smoke.yaml` to assume role `github-actions-role` via OIDC and deploy this package.
