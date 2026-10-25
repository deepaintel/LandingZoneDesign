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
| `docs/agent-instructions-archive/` | Archived domain governance and implementation constraints |
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
feature/* or hotfix/* -> main -> release/* -> Staging -> protected Production approval -> Production
```

`main` is the integration branch and is CI-only. Protected `release/*` branches are the deployment source.
Corrections to a release that has not been published yet are merged to `main`, selectively promoted
through a temporary `backport/*` branch, and merged into `release/*` through the required pull-request
controls. The release-push workflow validates and deploys Staging, then queues the same commit for the
protected `production` GitHub Environment. External Architecture, Security, Platform, and CAB
approvals remain outside the workflow; Environment reviewer approval releases the Production
job. Both environments synthesize their own configuration and deploy the same approved stack
sequence.

### Release branch lifecycle

Every release branch follows one path through `.github/workflows/deploy.yml`:

```text
Release branch            release/lz-v0.0.1 cut from main; the push starts deploy.yml
      |
Staging deployment        validate-and-deploy.yml in the staging Environment
      |
Validation                Production revalidates the same commit after Environment approval
      |
Production deployment     validate-and-deploy.yml in the production Environment
      |
GitHub Release            tag release-v0.0.1 on the deployed commit, then a Release
 + verified notes         with GitHub-generated notes, minus PRs an earlier release shipped
      |
Release branch deleted    release/lz-v0.0.1 is removed; the tag keeps the commit
```

Each step runs only if the step before it succeeded. Tagging, the GitHub Release, and branch
deletion all depend on the Production job (`tag-release` needs `deploy-to-production`,
`publish-release` needs `tag-release`, and `retire-release-branch` needs `publish-release`). A
successful Staging deployment on its own never tags, publishes, or deletes anything, and neither
does a rejected or failed Production job.

Each release job is a thin wrapper around one local composite action. `deploy.yml` owns the job
order, permissions, and inputs; the action owns the logic:

| Job in `deploy.yml` | Composite action | Inputs from the workflow |
| --- | --- | --- |
| `verify-release-branch` | `.github/actions/verify-release-branch` | token; outputs the release tag |
| `tag-release` | `.github/actions/tag-release` | release tag, `github.sha` |
| `publish-release` | `.github/actions/publish-github-release` | token, release tag, `github.sha`; outputs the release URL |
| `retire-release-branch` | `.github/actions/retire-release-branch` | read-only token, GitHub App ID and key, branch name, `github.sha`, release tag, Production and publish results; outputs the cleanup outcome |

Branch deletion happens automatically in the same run, as the last step after the tag and the
GitHub Release both exist. Creating a tag does not itself trigger deletion. A tag pushed by hand,
outside `deploy.yml`, deletes nothing; it only stops that branch from deploying again.

### Release notes

GitHub generates release notes from the commits between the previous tag and the new one. Hotfixes
reach a release branch as squash-merged backports, which are new commits with new SHAs, while the
next release is cut from `main`, where the original commits live. Without a correction, every
backported change looks new again and its PR is listed a second time. For `release-v0.0.2`, 33 of
the 45 commits in GitHub's range had already shipped in `release-v0.0.1`.

`publish-release` therefore asks GitHub for the notes as before and removes only the PRs whose
changes an earlier release already shipped (`scripts/release-notes.ts`, logic in `lib/release/`):

- **Previous release.** The most recent earlier `release-v*` tag by creation time. The tag only
  exists after Production succeeded. Version order is a consistency check, not the selector: if
  tag dates and versions disagree, or two tags share a timestamp, the step fails.
- **What counts as already shipped.** A commit in GitHub's range is excluded when it is reachable
  from any earlier release tag, or is equivalent to a commit that is: the same `git patch-id`, a
  `cherry-pick -x` trailer, or a shared PR number *together with* the same title. A PR number alone
  never excludes a change.
- **Original and backport PRs.** A backport squash such as `Fix (#31) (#32)` carries both numbers,
  so `#31` on `main` and `#32` in the release resolve to one change. The job summary lists every
  excluded PR with the earlier release, commit and signal that matched.
- **Ambiguity stops publication.** A shared PR number with a different title, an equal title with
  no number to confirm it, the same patch under an unrelated PR number (a possible re-landed
  change), a PR in the notes that no commit explains, a PR whose commits are partly released, or a
  generated entry that names no PR fails the step before any release is created. The tag stays, the branch is kept,
  and the job summary names each entry.
- **Incomplete history is an error.** When publishing, the release tag must be in the fetched git
  history and point at the released commit, every published Release must have its tag there, and
  the published Releases must be readable. Otherwise the step fails instead of treating the run as
  a first release. A preview only warns when it cannot read the published Releases.
- **First release and no new changes.** With no earlier release tag, GitHub's notes are used
  unchanged. When nothing is new, the notes say so and keep the *Full Changelog* link.

**Preview without deploying.** Run the **preview-release-notes** workflow (manual, read-only) with
the release tag and a branch, for example `release-v0.0.3` against `main`, to see the verified notes
and the report in the job summary. Locally, `pnpm release-notes:preview --release-tag release-v0.0.3
--target-ref main` does the same from git history alone. A preview builds the list from the commit
range because it does not call GitHub's generator; the publish step uses GitHub's real notes.

The notes of `release-v0.0.2` were published before this check existed and were not edited.

**Naming convention (unchanged).** The tag and the GitHub Release are both named `release-`
followed by the version at the end of the branch name. An optional prefix ending in `-` is
dropped:

| Release branch | Tag and GitHub Release |
| --- | --- |
| `release/lz-v0.0.1` | `release-v0.0.1` |
| `release/lz-v0.0.2` | `release-v0.0.2` |

Keep the `v` in the branch name. `release/0.0.1` would produce `release-0.0.1`.

**Released branches are closed.** Once its GitHub Release is published, a release branch is
closed. It must not receive additional commits, and it is never reopened, recreated, or
redeployed. The tag, the GitHub Release, and the infrastructure in both AWS Organizations all
describe one specific commit. A later commit on the same branch would match none of them and
would make the release history unreliable. Every later change, including a hotfix or a rollback,
ships as a new release branch with a higher version, such as `release/lz-v0.0.2`, cut from
`main`. The `backport/*` flow applies only to a release branch whose release has not been
published yet. Three controls enforce this:

- `retire-release-branch` deletes the branch automatically after the GitHub Release exists.
- If the branch is recreated and pushed, the preflight finds its existing tag and stops before any
  deployment, with an error telling you to cut a new release branch from `main`.
- `retire-release-branch` deletes the branch only while it still points at the released commit.
  If more commits arrived during the run, it keeps the branch and warns, so they can move to a new
  release branch instead of being lost.

**Repository settings.** Tagging and publication use the workflow's `GITHUB_TOKEN`. The publish and
cleanup jobs also read the existing `READ_PACKAGES` secret through `setup-workspace` to install the
toolchain. Administrators must configure:

- **Workflow token permissions.** The tag and release jobs request `contents: write` at job level.
  The repository or organization setting must not cap `GITHUB_TOKEN` below that, and `tag-release`
  already depends on it. The cleanup job requests only read access.
- **`release/**` branch rules.** Keep the existing protection and pull-request rule, which the
  preflight requires. Deletion of `release/**` may stay restricted: the release-cleanup GitHub App
  below deletes released branches through a ruleset bypass. Restricting creation of `release/**`
  to release managers is recommended.
- **`release-v*` tag ruleset.** Block tag updates and deletions. The "no reuse" guard relies on
  tags being permanent. Do not restrict tag creation for GitHub Actions, because `tag-release`
  pushes the tag with `GITHUB_TOKEN`.

### Release branch cleanup

`retire-release-branch` runs after the GitHub Release is published and is housekeeping only: it
never fails the release. `GITHUB_TOKEN` acts as `github-actions[bot]`, which cannot be put on a
ruleset bypass list, so the deletion uses a short-lived installation token of a dedicated GitHub
App that is.

1. With the read-only workflow token, the job checks that the branch is `release/lz-vX.Y.Z` and
   not the default branch, that the release tag matches the branch, that Production and the
   GitHub Release succeeded, that the branch still points at the released commit, that the tag
   points at it, that the Release is published, that no pull request targets or comes from the
   branch, that no `backport/lz-vX.Y.Z*` branch is waiting for a merged or closed pull request,
   and that no other workflow run or deployment is active on the branch.
2. Only when every check passes does it sign a JWT with the App key, request an installation
   token limited to this repository and `contents: write`, delete the branch, confirm it is gone,
   and revoke the token.
3. The outcome is `deleted`, `already-deleted`, `skipped` (a check did not pass, or the App is not
   configured yet) or `failed` (authentication, permission or ruleset refusal, or an error). The
   first two are notices; the others are warnings in the run's annotations, the job summary and
   the combined deployment summary. Any outcome other than `deleted` keeps the branch.

The run's result reflects Staging, Production, tagging and publication only. To retry cleanup
after fixing the reason, open the run and re-run the **Delete released branch** job; a branch
that is already gone counts as success.

**Configuration checklist for the repository administrators (IF).** These settings are made in
GitHub by IF, not by this repository.

1. **Create a GitHub App** owned by the organization, used for nothing else. Webhooks off. No
   user authorization.
2. **Repository permissions:** *Contents: Read and write* (deleting a ref needs it) and the
   mandatory *Metadata: Read-only*. Nothing else. The workflow additionally narrows each token to
   `contents: write` on this repository.
3. **Install the App** on this repository only (*Only select repositories*).
4. **Create the GitHub Environment `release-cleanup`** with *Deployment branches and tags* limited
   to `release/**`, and no required reviewers. In it, add the variable `RELEASE_CLEANUP_APP_ID`
   (the App ID; the Client ID also works) and the secret `RELEASE_CLEANUP_APP_PRIVATE_KEY` (the
   App's PEM private key). Environment scoping keeps the key away from every other branch and
   workflow.
5. **Bypass the deletion restriction for the App.** Put the deletion restriction for `release/**`
   in a repository ruleset that contains only *Restrict deletions*, and add the App to that
   ruleset's bypass list (*Always*). Keep pull-request, force-push and update rules in separate
   rulesets **without** the App, so the bypass covers deletion and nothing else.
6. **Check overlapping rules.** An organization-level ruleset that restricts deletion of these
   branches needs the same bypass, configured at organization level. Classic branch protection
   with *Allow deletions* off blocks deletion for every actor and offers no App bypass for it;
   move that restriction into the ruleset of step 5 or deletion keeps failing.
7. **Validate after merge, without deploying.** Confirm the App appears on the bypass list of
   step 5 only. Then, on the next release run, the **Delete released branch** job summary shows
   every check passed and outcome `deleted`. Before that, with the App configured but a check
   failing (for example an open pull request into the release branch), it shows `skipped` and the
   branch stays.

**What GitHub enforces and what the workflow enforces.** GitHub enforces the App's permissions,
its installation scope, the environment's branch restriction and secret access, the one-hour
token lifetime, and the bypass list. A bypass is not deletion-only by itself: an actor on a
ruleset's bypass list bypasses every rule of that ruleset, which is why step 5 isolates the
deletion rule. With *Contents: write*, anyone holding the App key could also push to branches the
App can bypass or that are unprotected. The workflow, not GitHub, limits the App's use to deleting
one released branch after the checks above. Rotate the private key if it may have been exposed.

**Failures and re-runs.** Use **Re-run failed jobs**, not **Re-run all jobs**. Each
post-deployment job is safe to run again. **Re-run all jobs** stops at the preflight once the tag
exists, which is the intended guard. A re-run executes the workflow file and commit of the
original run, and a re-run Production job needs Environment approval again.

| Failure | State left behind | Recovery |
| --- | --- | --- |
| Staging or Production fails, or Production is rejected | No tag, no Release, branch kept | Fix through `main` and a `backport/*` PR into the same branch, or re-run failed jobs for a transient failure. |
| Tagging fails | Production deployed, no tag, branch kept | Re-run failed jobs. A tag already pushed to the same commit is accepted; a tag on another commit fails the job. |
| GitHub Release creation fails | Tag exists, branch kept | Re-run failed jobs. An existing published Release is reused. A leftover draft fails the job until you publish or delete the draft. |
| Release notes cannot be verified | Production deployed, tag exists, no Release, branch kept | Read the ambiguous entries in the job summary. A transient API failure: re-run failed jobs. Otherwise a re-run reaches the same result, because it runs the original commit. Create the Release manually for the existing tag after reviewing its notes, delete the branch manually after checking its head matches the tag, and fix the check through a feature branch for the next release. Nothing deployed or tagged is changed. |
| Branch cleanup skipped or failed | Run succeeded; tag and Release exist, branch kept, warning in the summaries | Read the reason in the **Delete released branch** job summary, resolve it (for example the App configuration or an open pull request), then re-run that job, or delete the branch manually after checking its head matches the tag. A branch that is already gone counts as success. The preflight still blocks redeploys meanwhile. |
| Branch moved during the run | Run succeeded; tag and Release on the deployed commit, branch kept with a warning | The extra commits are not released. Ship them in a new release branch from `main`, then delete the old branch manually. |
| Re-run window expired | Whatever the failed job left | GitHub keeps re-runs available for 30 days. After that, create the missing Release manually for the existing tag, and delete the branch. |

**Rollback.** Never reopen a released branch. To return to an earlier state, revert the change on
`main` and cut a new release branch. Alternatively, cut a new, higher-version branch from an
earlier tag, for example `git push origin 'release-v0.0.1^{commit}:refs/heads/release/lz-v0.0.3'`.
Either way, it goes through the full Staging and Production flow. Redeploying older code does not
undo every change: retained resources such as AWS accounts, and Control Tower state, stay as they
are and may need their own remediation. To inspect a deleted release branch, check out its tag.

**Branches released before this lifecycle existed.** A branch that already has a tag, such as
`release/lz-v0.0.1`, is not cleaned up automatically, because no new run will deploy it. An
administrator should create its GitHub Release with generated notes for the existing tag, confirm
the branch head still equals the tag commit, and then delete the branch. Do this before the next
release is published. The notes check selects the previous release from the `release-v*` tags, so
a missing Release for an earlier tag does not widen the notes; the job summary only warns that the
earlier tag has no published Release.

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
missing. See `.apm/skills/initialize-control-tower/SKILL.md` for the trusted-access and
management-role details, including why this is an approved exception to the general
"do not pre-create Control Tower roles" rule (which continues to apply to member-account roles
such as `AWSControlTowerExecution`).

## Remaining Landing Zone accounts

The `deploy-landing-zone-accounts` composite action reconciles SharedServices, Network, and
(Staging only) the six CCoE Verification accounts with AWS Organizations on every release run,
through `scripts/provision-landing-zone-accounts.ts`. Configuration holds the desired state: OU
paths, names, emails, tags, and scope. The live Organization is the only source of Account IDs
and OU IDs. Nothing is stored or passed between stacks to connect them.

1. **Plan (read-only).** Resolves each configured OU path from the Organization Root, one level
   at a time. Then classifies every configured account by email, verifying the name second:
   - `EXISTING_MATCH` (reused)
   - `MISSING` (to be created)
   - `CONFLICT`: the email or name belongs to a different account, the account is not
     `ACTIVE`, it sits in another OU, or a create request for it is still in progress.

   Any `CONFLICT`, or an OU path that is missing or ambiguous, stops the run before anything
   is created. The plan table is written to the job summary.
2. **Provision.** Creates only `MISSING` accounts, one at a time, with their P1 tags. Each
   account is polled until `SUCCEEDED` and `ACTIVE`, then moved from the Root to its OU. The
   run stops at the first failure. An existing account found in the Root (an interrupted
   placement) is moved to its OU, and missing or drifted P1 tags are corrected. Organizations
   is eventually consistent, so each move and tag write is confirmed by bounded polling:
   - After a move, a read that still shows the Root keeps polling.
   - A read that shows any other OU fails the run without moving the account again.
3. **Validate (read-only).** A fresh plan must show every account reconciled. The action outputs
   `account-ids` (`<key>=<account id>` for every account, discovered or created in this run) and
   `ou-ids` (`<ou path>=<ou id>`), for later steps such as Control Tower enrollment.

Rerunning the release workflow after a partial failure resumes where it stopped: accounts that
already exist are reused, never created again. A `CONFLICT` is never fixed automatically; resolve
it in AWS Organizations or in configuration, then rerun.

Every Organizations request, including each page of a listing, is retried with bounded
exponential backoff and full jitter (`lib/organization/organizations-retry.ts`):

- **Settings:** 150 ms starting delay, at most 12 attempts, and a single wait capped at 20 s.
- **What is retried:** throttling, concurrent-modification, internal-service, and transient
  network errors.
- **What is not retried:** permanent errors, such as access denied, invalid input, or an account
  quota `ConstraintViolationException`. They fail at once with the AWS error and its reason.
- **CreateAccount and MoveAccount** are retried only when AWS rejected the request without acting
  on it.
- **No stacked retries:** the SDK's own retry is limited to a single attempt, so a request never
  makes more than 12 calls.

## Control Tower account auto-enrollment

With auto-enrollment on, AWS Control Tower applies a registered OU's baselines and controls to an
account as soon as the account is moved into that OU. The `configure-control-tower-auto-enrollment`
step turns it on after OU enrollment and its validation. It is the only code path that calls
`UpdateLandingZone`, and it can only enable the setting, never disable it.

- **Configuration.** Each environment sets `controlTower.autoEnrollment.enabled` explicitly;
  `config/default.yaml` has no value. Release A: Staging `true`, Production `false`. Release B
  sets Production to `true`, after the Staging checks, the controlled account-move test and the
  Suspended/decommissioning validation have passed and someone has signed off in writing.
- **Behaviour.** A read-only plan checks the identity, the Region, that the AWS CLI supports the
  call, the Landing Zone (version 4.0, `ACTIVE`, `IN_SYNC`, manifest unchanged) and any
  Landing Zone operation already running. Then:
  - Already enabled: nothing happens.
  - Disabled while configuration says `true`: exactly one `UpdateLandingZone` with the live ARN,
    the deployed version, the repository manifest and `INHERITANCE_DRIFT`. The run polls it with
    a time limit, then checks the result read-only and runs the enrollment validator again.
  - Enabled while configuration says `false`: the step fails; it does not disable anything.
- **Failures** are never retried or resubmitted, and are never "repaired" with a reset or with
  `EnableBaseline`. A re-run finds an operation that is still running, or sees that the setting
  is already on.
- **Operations.**
  - Every manual OU move needs an approved change ticket.
  - Moving an account to an OU that Control Tower does not govern, or to the organization root,
    can automatically remove its baselines and controls.
  - Never test with Security, Suspended or the root.
  - Turning the setting on does not fix drift from moves made earlier.
- **Rollback.** This implementation cannot disable the setting. Reverting the code or setting the
  configuration back to `false` does not turn it off in AWS.

Details, the read-only CLI runbook and the controlled Staging account-move test are in
`.apm/skills/control-tower-auto-enrollment/SKILL.md`. Staging must still confirm live in AWS
European Sovereign Cloud that `UpdateLandingZone` with `remediationTypes` works, along with the
runner CLI version and the `github-actions-role` permissions; offline tests cannot prove them.

## Common Account Security Baseline v1.0

The `reconcile-account-baseline` step runs last in each deployment job, after account provisioning,
Control Tower enrollment and auto-enrollment. It applies five enable-only account defaults to every
account in the environment's `landingZoneAccounts` (Staging: 8, Production: 2):

| Control | Target |
| --- | --- |
| S3 account-level Block Public Access | all four settings `true` |
| EBS encryption by default | enabled; the existing default KMS key is never changed (`alias/aws/ebs` approved) |
| EC2 IMDS account defaults | `HttpTokens=required`, `HttpPutResponseHopLimit=2` for future launches |
| EBS snapshot Block Public Access | `block-all-sharing` |
| AMI Block Public Access | `block-new-sharing` |

- **Never enforced:** Management, Audit, Log Archive and Suspended accounts. They are reported as
  `EXCLUDED` and never accessed.
- **Preflight gate first.** A read-only, environment-wide preflight must pass before any write.
  Conflicts are `REQUIRES_APPROVAL` and block the release:
  - public buckets, ACLs, snapshots or AMIs
  - an unapproved default KMS key
  - explicit IMDS settings
  - declarative-policy-managed settings
- **Apply, then validate.** Writes run account by account, each with a pre-write recheck and a
  bounded read-back. A read-only acceptance gate then requires exactly one valid result per expected
  account and control (Staging 40, Production 10).
- **Failure stops Production.** Any failure fails the job, so the protected Production job never
  starts after a failed Staging run.
- **Evidence:** the job summary matrix and the `account-baseline-report-<environment>` artifact.

Member accounts are reached through the established `OrganizationAccountAccessRole`. No IAM role,
Lambda function or StackSet is created. Details, prohibited operations, the acceptance rules and the
read-only CLI runbook are in `.apm/skills/common-account-baseline/SKILL.md`. The EUSC availability of each API is confirmed only
by the explicit capability checks in the live Staging run.

## Documentation authority

Use the following sources for detailed guidance:

- `docs/agent-instructions-archive/` preserves detailed domain governance, architecture constraints, and safety rules for on-demand reference.
- `.apm/skills/` contains task-specific implementation and validation procedures for AI agents.
- Approved design documents contain the target architecture and unresolved decisions.
- Source code and tests define the behavior that is currently implemented.

Generated agent files are outputs, not authoring sources. Update the relevant `.apm/` source and regenerate
model-specific files with APM rather than editing generated files directly.

## Current status

Before implementing a new Landing Zone capability, confirm its approved scope, external dependencies, AWS ESC
service support, configuration contract, tests, validation strategy, and deployment impact in the applicable
APM instruction and skill files.
