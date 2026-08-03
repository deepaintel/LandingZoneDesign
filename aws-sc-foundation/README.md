# aws-sc-foundation

Foundation pipelines to get a starting point for installing a landing zone

## Scaffold a New Package

Use the built-in scaffold script from the repository root:

```bash
pnpm run scaffold:package -- <package-name>
```

Example:

```bash
pnpm run scaffold:package -- identity-provider
```

### Optional Flags

- `--description "Short description"`: sets the package `description` in `package.json`.
- `--dry-run`: prints which files would be created without writing anything.

Example with options:

```bash
pnpm run scaffold:package -- network-foundation --description "Network baseline stack" --dry-run
```

### What Gets Generated

The scaffold creates a new folder under `packages/<package-name>/` with:

- `package.json`
- `cdk.json`
- `tsconfig.json`
- `vitest.config.ts`
- `bin/<package-name>.ts`
- `bin/<package-name>.test.ts`
- `lib/<package-name>-stack.ts`
- `lib/<package-name>-stack.test.ts`

Package names are normalized to `kebab-case`.

### After Scaffolding

Run:

```bash
pnpm install
pnpm --filter <package-name> run validate
```

For additional package conventions and manual setup guidance, see `packages/README.md`.
