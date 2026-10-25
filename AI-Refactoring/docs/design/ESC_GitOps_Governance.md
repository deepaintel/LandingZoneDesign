# AWS European Sovereign Cloud Landing Zone

# GitOps Governance and Release Process

| Field | Value |
|---|---|
| Document type | Foundational GitOps governance design, aligned with the initial repository implementation |
| Status | Initial design for stakeholder review; does not itself authorize a deployment |
| As-of revision | `3c33c2e` (`Uploading Design Documents`, 2026-10-22) |
| Platform | AWS European Sovereign Cloud, partition `aws-eusc`, Region `eusc-de-east-1` |
| Repository | `ccoe-aws/aws-sc-landing-zone` |

## Contents

- [AWS European Sovereign Cloud Landing Zone](#aws-european-sovereign-cloud-landing-zone)
- [GitOps Governance and Release Process](#gitops-governance-and-release-process)
  - [Contents](#contents)
  - [1. Purpose and Scope](#1-purpose-and-scope)
  - [2. Branch Model](#2-branch-model)
    - [2.1 Release Branch and Tag Names](#21-release-branch-and-tag-names)
  - [3. Continuous Integration](#3-continuous-integration)
  - [4. Release Preflight and Environment Promotion](#4-release-preflight-and-environment-promotion)
  - [5. Deployment Sequence](#5-deployment-sequence)
  - [6. Release Finalization](#6-release-finalization)
  - [7. Release Stabilization and Backports](#7-release-stabilization-and-backports)
    - [7.1 Preconditions](#71-preconditions)
    - [7.2 Backport Steps](#72-backport-steps)
    - [7.3 What the Repository Automates](#73-what-the-repository-automates)
  - [8. Evidence, Rollback, and Operational Limits](#8-evidence-rollback-and-operational-limits)
  - [9. Governance and Approval Boundary](#9-governance-and-approval-boundary)
  - [10. Consolidated Backport Checklist](#10-consolidated-backport-checklist)

## 1. Purpose and Scope

This is the foundational GitOps design for the new AWS European Sovereign Cloud Landing Zone project. It defines the branch lifecycle, validation gates, Staging-to-Production promotion, release stabilization, and evidence expected for Landing Zone infrastructure changes. The design is grounded in the current repository implementation so its operating model is actionable from the outset.

This document defines the GitOps governance model; it does not itself authorize a deployment or prove that administrator-managed GitHub settings are configured. Workflow automation and external approval controls are distinguished throughout.

## 2. Branch Model

```text
feature/* -> main -> new release/lz-vX.Y.Z
                         |
feature/fix-<name> -> main -> backport/* -> active, unpublished release/*
                                                   |
hotfix/<name> -> main -> new higher-version release/*
                         |
                         +-> protected Staging deployment
                         +-> protected Production Environment approval
                         +-> Production deployment of the same commit
                         +-> release-vX.Y.Z tag and GitHub Release
                         +-> released branch retirement
```

| Branch | Implemented role |
|---|---|
| `main` | Integration/source-of-truth branch. CI only; no AWS deployment or automatic release tag. |
| `feature/*` | Short-lived development branches. Pushes receive CI; no deployment. |
| `feature/fix-<name>` | Feature-branch naming convention for fixing an active release that has reached Staging but not Production. The fix merges to `main`, then is selectively backported to the active release. |
| `hotfix/<name>` | Branch naming convention for a defect in code already released to Production. The hotfix merges to `main` and is shipped through a new higher-version release; no direct Production deployment. |
| `release/*` | Only branch pattern that triggers AWS deployment. Must be protected, versioned, and have an active pull-request rule. |
| `backport/*` | Temporary branch created from an active, unpublished release branch; cherry-picks only approved fix commit(s) already merged to `main`. Never deploys directly. |

### 2.1 Release Branch and Tag Names

The workflow accepts a `release/*` branch whose suffix is semantic `MAJOR.MINOR.PATCH`, optionally prefixed by a label and hyphen. For example, `release/lz-v0.0.1` maps to tag `release-v0.0.1`; the `lz-` prefix is not included in the tag. The preflight checks the effective branch protection, confirms the current commit is the branch head, and rejects a release tag that already exists.

The source branching proposal assigns the conventional SemVer meanings: PATCH for backward-compatible fixes, MINOR for backward-compatible capabilities, and MAJOR for breaking changes. The workflow validates the version shape and tag uniqueness; it does not determine whether a particular change deserves a PATCH, MINOR, or MAJOR increment. That classification remains a reviewed release decision.

A release branch is immutable after release. The tag and published GitHub Release retain the deployed commit; the branch is retired after publication. A later fix or rollback uses a new, higher-version release branch from `main`, not a reopened released branch.

## 3. Continuous Integration

`.github/workflows/ci.yml` runs on pushes to `main`, `feature/**`, `hotfix/**`, and `backport/**`, and on pull requests targeting `main` or `release/**`. Because `feature/fix-<name>` matches `feature/**`, both its pushes and PR to `main` receive CI.

CI performs locked dependency installation, APM audit, configuration validation, TypeScript build and typecheck, lint, unit/CDK assertion tests, Staging and Production synth, and the corresponding static template and Control Tower manifest validators. It also checks AWS ESC partition/Region usage, scans for secrets and hardcoded identifiers, and parses workflow YAML to enforce deployment-authority and ordering constraints.

CI has read-only repository permissions and does not request `id-token: write`, obtain AWS deployment credentials, bootstrap CDK, or deploy. The current workflow does not include every check named in the earlier design proposals (for example, cfn-lint and Checkov); those must not be described as implemented CI gates unless added and verified in the workflow.

## 4. Release Preflight and Environment Promotion

A push to `release/**` starts `deploy.yml`. The preflight verifies the branch naming/version, protection and pull-request rule, branch-head SHA, and availability of the derived tag. A branch deletion event is not allowed to start deployment.

The deployment workflow invokes the reusable `validate-and-deploy.yml` job first for Staging and then for Production. Each invocation checks that the AWS environment is `staging` or `production` and matches the named GitHub Environment. It loads configuration from `config/default.yaml` plus the selected environment file, runs non-deploying validation, and then obtains short-lived credentials through the foundation-owned OIDC action for `github-actions-role`.

Production depends on successful Staging and is gated by the externally configured protected `production` GitHub Environment. After that approval, Production runs the same validation and deployment workflow against `config/production.yaml` and the same `github.sha` used for Staging. Staging treats a failed CDK diff as advisory; Production treats it as blocking.

## 5. Deployment Sequence

The reusable environment job deploys and validates the Landing Zone in this order:

1. Prepare the Organization and resolve live Organization and Root details.
2. Deploy the OU structure.
3. Deploy IAM Identity Center Permission Sets, SCIM synchronization, and SCIM cleanup.
4. Deploy Organization SCP/RCP policies.
5. Deploy the Audit and Log Archive shared accounts.
6. Deploy Control Tower prerequisite roles and initialize the Landing Zone 4.0 manifest.
7. Reconcile remaining accounts from configuration. Staging has SharedServices, Network, and six CCoE Verification accounts; Production has SharedServices and Network only.
8. Enroll configured OUs/accounts into Control Tower.
9. Configure the environment's enable-only Control Tower account auto-enrollment setting.
10. Reconcile and validate the Common Account Security Baseline.

For each environment, the workflow passes account, Organization, Root, OU, and Landing Zone values as runtime outputs/action inputs. Generated IDs are resolved from AWS and are not persisted in configuration or passed through CloudFormation exports. Account provisioning, Control Tower enrollment, auto-enrollment, and baseline actions have read-only plan/validation phases and fail closed on conflicts or incomplete state.

The Staging baseline covers eight configured accounts; Production covers two. Management, Audit, Log Archive, and Suspended accounts are excluded from that baseline. The workflow's deployment sequence and these account counts are enforced by configuration/schema and CI tests.

## 6. Release Finalization

After Production succeeds, the same workflow run:

1. Creates the `release-vX.Y.Z` tag on `github.sha` using `GITHUB_TOKEN` with `contents: write`.
2. Verifies generated release notes and publishes a GitHub Release for that existing tag. Ambiguous release-note history stops publication; the release job does not create another tag.
3. Attempts release-branch cleanup after Production, tagging, and publication have succeeded.

The cleanup job checks that the branch still points to the released commit and has no open PR, pending backport, other active workflow run, or active deployment. If every check passes, it uses a short-lived GitHub App installation token scoped to this repository and `contents: write` to delete the branch. Cleanup is housekeeping: failure is reported as a warning and does not change the successful release result. The combined, read-only deployment summary runs even if preceding jobs fail.

## 7. Release Stabilization and Backports

Use `feature/fix-<name>` for a fix to an active release candidate that has been deployed to Staging but has not reached Production. Use `hotfix/<name>` for a defect in code already released to Production. Neither branch type deploys directly; both merge to `main` through the normal PR and CI process. An unpublished release fix is then selectively backported. A Production hotfix is shipped through a new higher-version release because a published release branch is immutable.

### 7.1 Preconditions

- The fix has been implemented and reviewed on a feature/fix branch and merged to `main` through the normal PR and CI process.
- The unreleased-release fix has been implemented and reviewed on `feature/fix-<name>` and merged to `main` through the normal PR and CI process.
- The active `release/*` branch is still unpublished and under Staging validation. Its release tag must not already exist.
- The exact approved fix commit SHA(s) are known. Review each commit and confirm that it contains only the intended change and any necessary dependent changes.
- The backport PR must target the active release branch; do not push directly to that protected branch.

### 7.2 Backport Steps

1. Fetch current remote refs and verify the active release branch and approved commit:

    ```bash
    git fetch origin
    git branch -r --list 'origin/release/*'
    git show --stat --oneline <approved-fix-sha>
    ```

2. Create a new temporary branch from the active release branch, not from `main`:

    ```bash
    git switch --create backport/lz-v<version>-<fix-name> origin/release/lz-v<version>
    ```

3. Check whether the exact approved commit is already in the active release and inspect the release history and candidate change:

    ```bash
    git merge-base --is-ancestor <approved-fix-sha> origin/release/lz-v<version>
    git log --oneline -20 origin/release/lz-v<version>
    git show --stat --oneline <approved-fix-sha>
    ```

    If `merge-base` succeeds, the exact commit is already in the release branch and must not be cherry-picked again. If it reports that the commit is not an ancestor, review the release history for an equivalent prior backport before proceeding. Only if the fix is absent, cherry-pick the approved commit from the backport branch:

    ```bash
    git cherry-pick <approved-fix-sha>
    ```

    Do not merge `main` wholesale, include unrelated commits, or cherry-pick while checked out on `release/*`.

4. Resolve only conflicts required to apply the approved fix. If resolution is unsafe or expands the change beyond the approved scope, abort and return to the fix PR for review:

    ```bash
    git status
    git cherry-pick --continue
    # or, if the conflict cannot be resolved safely:
    git cherry-pick --abort
    ```

5. Review the resulting diff and history, then push the temporary backport branch:

    ```bash
    git diff origin/release/lz-v<version>...HEAD
    git log --oneline -5
    git push --set-upstream origin backport/lz-v<version>-<fix-name>
    ```

6. Raise a PR from `backport/*` to the active `release/*` branch. Require the applicable CI checks, review, approval, and protected-branch rules. The PR must contain only the approved fix.

7. After the approved PR is merged, the push to `release/*` triggers the normal release workflow. Revalidate the updated candidate in Staging. Promote the same validated commit to Production only through the protected Production Environment gate.

8. After merge and successful Staging revalidation, delete the temporary backport branch using the configured PR/repository branch cleanup behavior. The repository does not deploy from or automatically use the backport branch itself.

If the backported change causes a regression during Staging validation, revert it through a separately reviewed remediation branch and PR. Redeploy and revalidate Staging before Production promotion; do not make an ad hoc direct edit to the protected release branch.

If another issue is found before Production publication, repeat the same process with a new backport branch from the updated active release branch. Do not cut a new release version solely because a Staging fix was needed. Once Production has succeeded and the GitHub Release has been published, the release branch is retired; later corrections require a new, higher-version release from `main`.

### 7.3 What the Repository Automates

The workflow validates that a pushed release branch is protected, follows the expected semantic version form, points at the triggering commit, and has no existing release tag. After a backport PR is merged into an active release branch, that push enters the same Staging and Production workflow as any other release update. CI also runs for `backport/**` pushes and PRs targeting `release/**`.

The repository does not create the backport branch, cherry-pick commits, open/approve/merge the backport PR, or guarantee temporary backport-branch deletion. Those are operator and GitHub repository processes. There is no direct hotfix-to-Production workflow.

The release-note verifier recognizes already-released changes by commit equivalence and fails closed on ambiguous history. It complements the backport process; it does not replace PR review or approval.

## 8. Evidence, Rollback, and Operational Limits

The combined summary records the release branch and commit, Staging/Production results, generated Organization and Control Tower outputs, account-baseline acceptance/results, tag, GitHub Release URL, and cleanup outcome. Individual deployment actions and the baseline report provide more detailed evidence.

There is no repository workflow that automatically rolls back a successful Landing Zone deployment. The implemented recovery path is a new reviewed fix/backport for an unpublished release, or a new higher-version release from `main` after publication. AWS service rollback behavior is separate from this GitOps process.

The workflow does not itself implement CAB ticket validation, reviewer identity/count rules, deployment windows, or every reviewer checklist from the source designs. PR branch rules, Production Environment reviewers, release-cleanup Environment restrictions/secrets, the cleanup App installation and ruleset bypass, and the foundation OIDC trust/role permissions are configured outside this repository. Their live configuration must be verified by the responsible administrators.

The source designs also state that manual changes to managed AWS resources are prohibited except for approved break-glass actions, which must be reconciled back into code. The GitOps workflows do not enforce this as a general console-change detector. CloudTrail, CloudFormation, and AWS Config records are external audit evidence; the GitHub summary is not a substitute for those service records. Release-branch creation authority and role-specific human reviewer requirements likewise depend on GitHub rules and operating procedures outside the workflow files.

## 9. Governance and Approval Boundary

The workflow enforces repository-verifiable conditions: CI requirements, release-branch naming and protection checks, release-tag uniqueness, Staging-before-Production sequencing, and successful use of the protected Production GitHub Environment. It uses the same release commit for both environments and prevents release finalization unless Production succeeds.

The following controls are configured or operated outside the workflow and must be maintained by the responsible administrators and approvers:

- Branch rules requiring pull requests, reviews, successful CI, and authorized release-branch creation.
- Production GitHub Environment reviewers and any separate Architecture, Security, Platform, CAB, or change-management approvals.
- Release-cleanup Environment branch restrictions and credentials, GitHub App installation and permissions, and ruleset bypass configuration.
- Foundation-owned GitHub OIDC provider, deployment-role trust, and AWS permissions.
- Retention of CloudTrail, CloudFormation, and AWS Config audit records.

The repository exposes workflow summaries, deployment outputs, release tags, GitHub Releases, and account-baseline reports as evidence. It does not validate CAB ticket IDs, enforce reviewer role or count, set deployment windows, detect all manual AWS changes, or automatically roll back a successful deployment. Manual changes to managed resources require approved break-glass handling and reconciliation into code.

There is no direct hotfix-to-Production path. A fix to an unpublished release must pass through `main`, an approved backport PR, Staging revalidation, and the normal Production gate. Once a release is published, corrections use a new higher-version release branch.

## 10. Consolidated Backport Checklist

- Feature and hotfix branches are created from `main`; protected branches receive changes through PRs, not direct commits.
- Use `feature/fix-<name>` for an issue found in Staging before Production; use `hotfix/<name>` for a defect in a release already deployed to Production.
- Release branches are created from an approved, validated `main` commit and are restricted to authorized release managers by external repository settings.
- Fix merged to `main` through the approved PR and CI path.
- Active release branch is unpublished and its current commit is confirmed.
- Approved fix SHA(s) inspected; no unrelated changes included.
- New `backport/*` branch created from the active release branch.
- Only approved fix commit(s) cherry-picked; no wholesale merge from `main`.
- Backport diff reviewed and pushed.
- PR targets the active `release/*` branch and passes CI, review, approval, and branch rules.
- After merge, the normal workflow redeploys/revalidates Staging.
- Production promotion uses the same validated release commit and protected Environment gate.
- Temporary backport branch is removed after merge and Staging validation through the configured repository process.
- Release tag and GitHub Release are created only after successful Production deployment; the released branch is then retired and not reused.
- The workflow rejects reuse of an existing release tag. Administrator-managed tag rules should also prevent tag updates and deletion.
