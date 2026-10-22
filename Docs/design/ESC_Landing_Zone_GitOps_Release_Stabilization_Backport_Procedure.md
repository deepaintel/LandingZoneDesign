**AWS ESC Landing Zone - GitOps Release Stabilization**

| **Purpose**            | Define the controlled process for moving an approved Staging fix into the active release branch through a temporary backport branch. |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| **Example Release**    | release/lz-v0.0.1                                                                                                                    |
| **Example Backport**   | backport/lz-v0.0.1-accountid-fix                                                                                                     |
| **Example Fix Commit** | 68c34c606b4caef52bfac4410c97fe5037588a42                                                                                             |
| **Deployment Target**  | Staging first; Production only after successful Staging validation and required approvals.                                           |

# 1. Purpose

This document explains the controlled backport process to be followed when an issue is identified during Staging validation of an active release candidate. It is intended to be understandable to both technical and non-technical reviewers while retaining the exact Git steps required by the engineering team.

The active release branch is protected. Therefore, a Staging fix is never committed or cherry-picked directly into release/\*. The fix must first follow the normal feature/fix -\> main process. A temporary backport branch is then created from the active release branch, and only the approved fix commit from main is brought into that temporary branch for review and merge.

# 1.1 Success Criteria

A release stabilization backport is considered complete when:

- The fix has been merged to main.

- The approved fix commit SHA(s) have been backported through a dedicated backport/\* branch.

- CI, review, and approval requirements have passed.

- The updated release candidate has been successfully revalidated in Staging.

- The same validated release baseline has been promoted to Production.

- The release tag has been created from the Production-approved baseline.

# 2. What Is a Backport Branch?

A backport branch is a temporary branch used to safely move a specific, already-approved fix into an existing release candidate without bringing all newer changes from main into that release.

- The backport branch is created FROM the currently active release/\* branch.

- The required fix is first completed, reviewed, CI-validated, and merged into main.

- Only the approved fix commit SHA from main is cherry-picked into the backport branch.

- A pull request is raised from backport/\* to the active release/\* branch.

- The protected release branch changes only after CI, review, and approval on that backport PR.

- The backport branch is temporary and does not deploy directly. Deployment occurs only after the approved change reaches release/\*.

**Why this is required:** It keeps the release candidate stable and auditable. The release receives only the intended approved fix, rather than every change that may have entered main after the release branch was created.

**Important distinction:** The backport branch starts from release/lz-v0.0.1. It does not start from main. The fix commit comes from main and is cherry-picked into the backport branch.

# 

# 3. Flow 1 - Business / Process View

The following view explains the stabilization process in plain language.

| **Stage**                      | **What happens**                                                                                                                                      |
|--------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1. Issue found in Staging**  | A problem is identified while validating the current release candidate in Staging.                                                                    |
| **2. Fix developed**           | The correction is implemented in a feature/fix-\* branch.                                                                                             |
| **3. Standard approval**       | A PR is raised to main. CI checks, review, and approval must pass.                                                                                    |
| **4. Fix reaches main**        | The approved fix is merged into main and its commit SHA is recorded.                                                                                  |
| **5. Backport branch created** | A temporary backport/\* branch is created from the CURRENT active release branch, for example release/lz-v0.0.1 -\> backport/lz-v0.0.1-accountid-fix. |
| **6. Approved fix brought in** | Only the approved fix commit SHA from main is cherry-picked into the backport branch.                                                                 |
| **7. Backport reviewed**       | A PR is raised from backport/\* to release/lz-v0.0.1. CI, review, and approval must pass.                                                             |
| **8. Release updated**         | The approved backport PR is merged into the existing release/lz-v0.0.1 branch.                                                                        |
| **9. Staging redeployed**      | The updated release branch is deployed again to Staging.                                                                                              |
| **10. Revalidation**           | The fix and required regression checks are validated in Staging.                                                                                      |
| **11. If validation fails**    | Repeat the same feature/fix -\> main -\> backport -\> release stabilization cycle.                                                                    |
| **12. If validation passes**   | Obtain required Production approvals and deploy the SAME release candidate to Production.                                                             |
| **13. Finalize release**       | After successful Production validation, create the release tag, for example lz-v0.0.1.                                                                |

# 4. Flow 2 - Git Branch / Technical View

The following view shows exactly where each branch originates and how the approved fix reaches the protected release branch.

> Issue found in Staging  
> \|  
> v  
> feature/fix-accountid  
> \|  
> \| PR + CI + Review + Approval  
> v  
> main  
> \|  
> \| approved fix commit SHA  
> \|  
> \| release/lz-v0.0.1  
> \| \|  
> \| \| create temporary branch FROM release  
> \| v  
> +---- cherry-pick fix ----\> backport/lz-v0.0.1-accountid-fix  
> \|  
> \| PR + CI + Review + Approval  
> v  
> release/lz-v0.0.1  
> \|  
> \| release workflow  
> v  
> Staging  
> \|  
> validate / revalidate  
> / \\  
> fail pass  
> \| \|  
> repeat fix/backport approvals  
> \| \|  
> +-----\> Production  
> \|  
> v  
> tag lz-v0.0.1

**Key point:** No direct commit and no direct cherry-pick is performed on release/lz-v0.0.1. All changes enter the release branch through an approved backport PR.

# 5. Governing Rules

- Never commit directly to an active release/\* branch.

- Never cherry-pick directly while checked out on the active release/\* branch.

- All fixes must reach main first through the standard PR, review, and CI process.

- Create the temporary backport/\* branch from the active release/\* branch, not from main.

- Cherry-pick only the approved fix commit(s) from main into the backport branch.

- Raise a PR from backport/\* to the active release/\* branch.

- The backport PR must pass CI, review, and approval before merge.

- The approved merge to release/\* triggers or enables Staging redeployment for revalidation.

- Do not create a new release version solely for issues identified before Production.

- After successful Production validation, tag the approved release baseline.

# 6. Example Used in This Procedure

| **Active release branch** | release/lz-v0.0.1                               |
|---------------------------|-------------------------------------------------|
| **Backport branch**       | backport/lz-v0.0.1-accountid-fix                |
| **Approved fix commit**   | 68c34c606b4caef52bfac4410c97fe5037588a42        |
| **Suggested PR title**    | Backport aws.accountId fix to release/lz-v0.0.1 |

# 7. Preconditions

- The issue has been corrected in a feature/fix branch.

- The feature/fix PR has passed required CI checks, review, and approval.

- The fix has been merged into main.

- The exact approved fix commit SHA is known.

- The active release branch exists and is the release currently under Staging validation.

- The engineer has permission to create and push a backport branch and raise a PR.

- The release/\* branch remains protected and direct writes are not permitted.

# 8. Step-by-Step Backport Procedure

## Step 1 - Fetch the latest remote branches

Refresh local branch and commit information.

> git fetch origin

## Step 2 - Verify the active release branch exists

Confirm the expected active release branch is available remotely.

> git branch -r \| grep release/lz-v0.0.1

## Step 3 - Switch to the active release branch

Move to the release baseline from which the backport branch must be created.

> git checkout release/lz-v0.0.1 \[OR\]
>
> git switch release/lz-v0.0.1

## Step 4 - Pull the latest release content

Ensure the local release branch matches the latest remote protected baseline.

> git pull origin release/lz-v0.0.1

## Step 5 - Create the temporary backport branch

Create the backport branch FROM the active release branch.

> git checkout -b backport/lz-v0.0.1-accountid-fix

## Step 6 - Check whether the fix is already present

Verify the approved SHA(s) are not already contained in the release history.

> git branch --contains 68c34c606b4caef52bfac4410c97fe5037588a42  
> git log release/lz-v0.0.1 --oneline \| grep 68c34c606b4caef52bfac4410c97fe5037588a42

## Step 6A - Review the Approved Fix Commit

Confirm that the selected commit SHA(s) contains the intended approved correction before performing the cherry-pick. Verify that no unrelated files or changes are included in the commit.

> git show 68c34c606b4caef52bfac4410c97fe5037588a42

## Verify that no unrelated files or changes are included in the commit.

## Step 7 - Cherry-pick the approved fix

If it is not already present, bring ONLY the approved fix commit from main into the backport branch.

> git cherry-pick 68c34c606b4caef52bfac4410c97fe5037588a42

If the approved correction consists of multiple commits, identify all required dependent commits and cherry-pick only those approved commits necessary for the fix.

> git cherry-pick \<sha1\> \<sha2\> \<sha3\>

## Step 8 - Verify the resulting history

Confirm the branch contains the intended release baseline plus the approved fix.

> git log --oneline -5

## Step 9 - Push the temporary backport branch

Publish the branch so a protected PR can be raised.

> git push -u origin backport/lz-v0.0.1-accountid-fix

## Step 10 - If the cherry-pick has a conflict

Do not add an unrelated ad-hoc release fix. Resolve only the conflict required to apply the already-approved change.

> git status

After resolving the intended files:

> git add \<resolved-files\>  
> git cherry-pick --continue

If the conflict cannot be resolved safely, stop and abort the operation:

> git cherry-pick --abort

# 9. Raise the Backport Pull Request

| **Source branch** | backport/lz-v0.0.1-accountid-fix                       |
|-------------------|--------------------------------------------------------|
| **Target branch** | release/lz-v0.0.1                                      |
| **PR title**      | Backport aws.accountId fix to release/lz-v0.0.1        |
| **Scope**         | Only the approved fix commit already merged into main. |

Suggested PR description:

> Purpose:  
> Backport the approved aws.accountId fix from main into the active  
> release/lz-v0.0.1 release candidate for Staging revalidation.  
>   
> Approved fix commit:  
> 68c34c606b4caef52bfac4410c97fe5037588a42  
>   
> Scope:  
> - Backport only the approved fix.  
> - No direct changes were made to release/lz-v0.0.1.  
> - No new release version is created.  
> - After approval and merge, the existing release candidate is redeployed  
> to Staging for validation.

# 10. PR Review and Merge Requirements

- All required CI checks must pass.

- Required reviewers must review and approve the PR.

- Confirm that the PR diff contains only the intended backport change.

- Do not merge unrelated main-branch changes into the release branch.

- Merge the approved backport PR into the active release/\* branch only through the protected PR process.

  **<span class="mark">Why Main Is Not Merged into Release</span>**

  The main branch may contain additional features, enhancements, refactoring changes, or other work that was

  not part of the approved release candidate. Backporting ensures that only the specifically approved fix

  is introduced into the release branch, preserving release stability, predictability, and auditability.

# 11. Staging Redeployment and Revalidation

After the approved backport PR is merged into release/lz-v0.0.1, the branch remains the same release candidate. The updated release baseline is redeployed to Staging and validated again.

- Verify the release workflow uses the active release/\* branch.

- Confirm deployment completes successfully.

- Re-run validation for the affected fix and required regression checks.

- Record the validation evidence in the normal release/change process.

- Do not promote to Production until Staging validation passes.

# 11A - Backport Reversion

If a backported fix introduces an unexpected issue during Staging validation, revert the change through the

normal pull request process rather than making direct modifications to the release branch.

**Example:**

git revert \<merge-commit-sha\>

Then:

- Create a new remediation branch.

- Raise a PR.

- Complete review and approval.

- Redeploy to Staging.

- Revalidate the release candidate.

# 

# 

# 12. If Another Issue Is Found During Staging

Repeat the same stabilization cycle. The next fix must again be developed through a feature/fix branch and merged to main. Then create a NEW temporary backport branch from the current active release/lz-v0.0.1 branch and cherry-pick only the newly approved fix commit.

> new feature/fix-\* -\> PR -\> main  
> \|  
> \| new approved fix SHA  
> v  
> current release/lz-v0.0.1 -\> NEW backport/\* -\> PR -\> release/lz-v0.0.1 -\> Staging

Do not create release/lz-v0.0.2 merely because one or more Staging fixes were required. release/lz-v0.0.1 remains the release candidate until it is approved for Production or formally abandoned.

# 13. Production Promotion and Tagging

Once Staging validation passes and the required approvals are complete, Production must deploy the exact Git commit or merge commit that successfully completed Staging validation. No additional commits, merges, rebases, cherry-picks, or configuration changes should be introduced between final Staging validation and Production deployment.

- Use the approved release/lz-v0.0.1 baseline for Production.

- Production promotion remains subject to the existing manual approval/governance process.

- After successful Production validation, create the corresponding release tag, for example lz-v0.0.1.

  Example:

> git tag -a lz-v0.0.1 -m "Release lz-v0.0.1"
>
> git push origin lz-v0.0.1

The tag must be created from the Production-approved release commit.

# 13A - Backport Branch Cleanup

After the backport PR has been merged and the release candidate has successfully completed Staging

Validation, remove the temporary backport branch.

The branch may be deleted either:

- Automatically through the pull request platform's **Delete Branch** option after merge.

- Manually from the remote repository and local workstation.

git push origin --delete backport/lz-v0.0.1-accountid-fix

git branch -d backport/lz-v0.0.1-accountid-fix

Organizations may enable automatic deletion of merged branches within their source control platform. If

available, using the PR platform's branch deletion option is recommended because it ensures cleanup occurs

immediately after merge. This helps prevent stale temporary branches and keeps the repository clean.

# 14. Key Do / Do Not Rules

| **DO**                                          | **DO NOT**                                                     |
|-------------------------------------------------|----------------------------------------------------------------|
| Fix through feature/fix -\> PR -\> main.        | Commit directly to release/\*.                                 |
| Create backport from the active release branch. | Cherry-pick directly while checked out on release/\*.          |
| Cherry-pick only approved main commit(s).       | Merge main wholesale into release/\*.                          |
| Raise PR from backport/\* to release/\*.        | Include unrelated commits in the backport.                     |
| Run CI/review/approval before merge.            | Create a new release version for a pre-Production Staging fix. |
| Redeploy and revalidate Staging.                | Promote to Production before Staging passes.                   |

# 15. Backport Completion Checklist

**\[ \]** Fix merged to main through approved PR.

**\[ \]** Approved fix commit SHA(s) confirmed.

**\[ \]** Active release branch updated locally.

**\[ \]** Backport branch created from the active release branch.

**\[ \]** Fix verified as not already present in release history.

**\[ \]** Only approved fix commit(s) cherry-picked.

**\[ \]** Backport branch pushed.

**\[ \]** PR raised from backport/\* to active release/\*.

**\[ \]** CI checks passed.

**\[ \]** Required review/approval completed.

**\[ \]** PR merged to active release/\*.

**\[ \]** Staging redeployment completed.

**\[ \]** Staging validation passed.

**\[ \]** Production promotion performed only after approval.

**\[ \]** Release tagged only after successful Production validation.

\[ \] Temporary backport branch deleted or automatically cleaned up after merge.
