---
name: manage-landing-zone-release-workflows
description: >-
  Use when creating, reviewing, or changing GitHub Actions CI/release workflows, local composite actions,
  release branch/tag lifecycle, release notes, or branch cleanup in the AWS ESC Landing Zone repository.
---

# Manage Landing Zone Release Workflows

This skill owns the shared GitOps release lifecycle and the responsibility boundary between caller workflows and reusable local composite actions. Domain skills remain authoritative for each action's inputs, outputs, resource scope, and technical validation.

## Branch and Deployment Authority

Normal release flow:

```text
feature/* -> main -> release/* -> Staging -> protected Production approval -> Production
          -> release tag + GitHub Release -> release branch deleted
```

Rules:

- `main` is the protected integration/source-of-truth branch and runs CI only; it never deploys.
- Feature and hotfix branches originate from `main`; `release/*` is the only AWS deployment source.
- `backport/*` is created from the active, unpublished release branch, receives only specifically approved commits already merged to `main`, and reaches `release/*` through PR, CI, review, and approval. It never gets AWS credentials or deploys directly.
- No direct commits/cherry-picks to `release/*`; unrelated `main` commits must not enter the active release.
- Staging and Production use the same release commit. Production resumes the same release run after Staging succeeds and the protected `production` GitHub Environment approval is granted before any Production validation, OIDC, or AWS access.
- External Architecture, Security, Platform, CAB/change approvals remain outside GitHub unless explicitly integrated.
- A released branch is closed. Never reopen, recreate, redeploy, or add commits to it; fixes and rollbacks use a new higher-version release branch from `main`.

## Release Lifecycle

`.github/workflows/deploy.yml` drives the release through one lifecycle:

1. Verify the protected release branch, semantic version, and that the release tag does not already exist.
2. Deploy Staging from the release commit in the `staging` GitHub Environment.
3. After Staging succeeds, queue Production for the same SHA in the protected `production` Environment. Approval is required before the job starts.
4. Only after successful Production, create the version tag on the deployed commit, publish the GitHub Release for that existing tag with verified GitHub-generated notes, then attempt released-branch retirement.

The branch format is `release/<prefix>-v<MAJOR.MINOR.PATCH>`; the tag and GitHub Release are `release-v<MAJOR.MINOR.PATCH>` with the branch prefix removed. For example, `release/lz-v0.0.1` maps to `release-v0.0.1`. Keep the current branch pattern, derivation, and tag format unchanged.

### Release Notes

- Tag creation is idempotent and pins the deployed commit. Publishing attaches to the existing tag only; never let GitHub create a tag as a side effect of release creation.
- GitHub-generated notes are verified before publishing. Since backports may be squash-merged with new SHAs, compare all earlier published release tags, not only the most recent one, and exclude already-released changes only on sufficient evidence: commit reachability, patch identity, `cherry-pick -x`, or matching PR number plus title.
- Ambiguous or incomplete history fails before publishing. A tag must exist in fetched history and point at the deployed commit; published releases must be readable and their tags must exist in that history.
- On ambiguous notes/history, leave the tag, deployment, and branch unchanged. Recover the existing release manually and deliver fixes through a new release from `main`. The first release uses GitHub's generated notes unchanged.
- `preview-release-notes.yml` is manually triggered, read-only, has no AWS credentials, and never tags, publishes, or deletes.

### Released-Branch Retirement

Branch deletion is housekeeping, not a release gate. It may run only after the tag and published GitHub Release exist and only if the branch still points at the released commit. Keep the branch if any check is uncertain or if more commits arrived.

Before deletion, verify the branch name/version, default-branch exclusion, successful Production deployment, published release and matching tag/SHA, and absence of open PRs, pending backports, other workflow runs, or deployments using the branch. Use a short-lived release-cleanup GitHub App installation token scoped to this repository and `contents: write`; revoke it afterwards. Cleanup results are `deleted`, `already-deleted`, `skipped`, or `failed`; non-deletion is a warning, not a failed release. Never create/configure the App, its permissions, or rulesets from this repository.

Post-Production job order is tag -> publish -> retire. A Staging-only success, rejected Production approval, or failed Production job must never tag, publish, or delete. Post-Production jobs must support rerunning failed jobs safely; rerun-all stops at preflight once the release tag exists.

## Workflow and Composite-Action Boundary

The caller workflow owns orchestration and authorization. It must retain:

- triggers, job dependencies (`needs`), concurrency, environment selection, permissions, and decisions about which action runs when;
- release branch/version/SHA validation and Staging-before-Production ordering;
- protected GitHub Environment use and the Production approval gate;
- the initial checkout before local actions, AWS OIDC setup, and placement of `id-token: write`;
- runtime resolution/handoff of stack outputs and workflow-level summaries/evidence;
- post-Production job order and the inputs/tokens passed to release actions.

A local composite action under `.github/actions/<action>/action.yml` may encapsulate a cohesive, reusable implementation responsibility. Do not extract repeated lines that do not form a cohesive unit or merge actions with distinct resource/security scopes. Topic skills define the action-specific boundary, for example:

- OU stack deployment: `.apm/skills/generate-landing-zone-ou/SKILL.md`;
- Organization policy deployment: `.apm/skills/generate-scp/SKILL.md`;
- account provisioning: `.apm/skills/generate-account/SKILL.md`;
- Control Tower initialization/enrollment/auto-enrollment: their respective skills.

Every action must declare only needed inputs and outputs, receive environment/other branch-driving values explicitly, avoid behavior selected by literal environment strings, source configuration using the repository reader/schema, and propagate failures. Actions performing AWS API calls inherit workflow credentials; they do not set up another credential set or request `id-token: write` themselves. Long-running approved Control Tower actions may refresh the same role via the shared credentials action when authorized by their own skill.

Keep workflow orchestration in workflows, not action inputs or shell code. In particular, never move Production approval, release authorization, or workflow-level job ordering into a composite action.

## Shared Deployment Order

Preserve the approved stack/action order in both environments:

1. Organization/Root resolution and OU structure.
2. Identity Center and SCIM resources.
3. Organization policies.
4. Audit/Log Archive shared accounts.
5. Control Tower prerequisite roles and Landing Zone initialization using Path A outputs.
6. Remaining approved Landing Zone accounts.
7. Control Tower OU enrollment.
8. Enable-only Control Tower account auto-enrollment.
9. Common Account Security Baseline as the final deployment step.

The protected Production Environment gates the entire Production job. Do not add a separate Production trigger, bypass, or deployment mechanism.

## Validation and Safety

Workflow/composite changes must preserve existing tests, synth and static validators; add focused tests for action behavior testable in isolation. Validate that CI has no AWS credentials or deployment authority, no action can bypass the Production gate, and no cross-stack `Export`/`ImportValue` or CDK dependency is introduced. CloudFormation coupling constraints are also always-on in `.apm/instructions/landing-zone-global.instructions.md`.

During authoring and review, use non-deploying validation only. Never run `cdk deploy`/bootstrap, mutate AWS, trigger GitHub workflows, or perform Git write operations.
