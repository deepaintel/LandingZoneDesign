#!/bin/bash
# Enable AWS Organizations trusted access for AWS Control Tower prerequisites.
#
# API-based Control Tower Landing Zone setup (CreateLandingZone) requires trusted access
# to be enabled for the services Control Tower orchestrates. The Console flow enables
# these automatically; the API flow does not. See:
# https://docs.aws.amazon.com/controltower/latest/userguide/enable-trusted-access.html
# https://docs.aws.amazon.com/controltower/latest/userguide/setting-up-lz-api.html
#
# Governed by .apm/instructions/control-tower-initialization.instructions.md §6.1.
#
# Enabling trusted access is:
#   - idempotent (safe to re-run; AWS returns success if already enabled)
#   - one-time-per-organization (not per environment)
#   - auto-creates the corresponding service-linked role in the management account
#     for services that use one (Control Tower's AWSServiceRoleForAWSControlTower,
#     Config's AWSServiceRoleForConfig, and StackSets' service-linked role).
#
# Usage:
#   ./enable-org-trusted-access.sh [aws-region]
#
# Called from .github/actions/initialize-control-tower/action.yml BEFORE pre-init checks.

set -euo pipefail

AWS_REGION="${1:-eusc-de-east-1}"

# Service principals whose trusted access is required for API-based Control Tower init.
# Order matches the dependency chain: Control Tower first (creates its SLR), then
# supporting services.
SERVICE_PRINCIPALS=(
  "controltower.amazonaws.com"
  "member.org.stacksets.cloudformation.amazonaws.com"
  "config.amazonaws.com"
  "config-multiaccountsetup.amazonaws.com"
)

echo "Enabling AWS Organizations trusted access for Control Tower prerequisites"
echo "  Region: ${AWS_REGION}"

# Snapshot currently-enabled trusted access, once, to keep this idempotent without
# re-hitting the API for each principal.
CURRENT_TRUSTED_ACCESS=$(aws organizations list-aws-service-access-for-organization \
  --region "${AWS_REGION}" \
  --query 'EnabledServicePrincipals[].ServicePrincipal' \
  --output text)

FAILED=0
for principal in "${SERVICE_PRINCIPALS[@]}"; do
  if printf '%s\n' ${CURRENT_TRUSTED_ACCESS} | grep -qx "${principal}"; then
    echo "  [skip] ${principal} (already enabled)"
    continue
  fi

  echo "  [enable] ${principal}"
  ENABLE_STDERR=$(mktemp)
  if aws organizations enable-aws-service-access \
      --service-principal "${principal}" \
      --region "${AWS_REGION}" \
      2>"${ENABLE_STDERR}"; then
    rm -f "${ENABLE_STDERR}"
    echo "    ✅ enabled"
  else
    ERR=$(cat "${ENABLE_STDERR}")
    rm -f "${ENABLE_STDERR}"
    # AWS returns AccessDenied/ValidationException with distinctive messages when the
    # principal is not recognized by AWS Organizations in this partition. Surface the
    # exact error so ESC-specific naming issues are visible in the workflow log.
    echo "    ❌ enable-aws-service-access failed for ${principal}" >&2
    echo "    AWS error: ${ERR}" >&2
    FAILED=1
  fi
done

if [ "${FAILED}" -ne 0 ]; then
  echo "::error::One or more trusted-access enablements failed. Control Tower initialization cannot proceed."
  exit 1
fi

# Verify the AWSServiceRoleForAWSControlTower SLR exists after enabling trusted access.
# It is auto-created when controltower.amazonaws.com trusted access is first enabled;
# fall back to explicit CreateServiceLinkedRole if the auto-creation did not land.
SLR_NAME="AWSServiceRoleForAWSControlTower"
echo "Verifying service-linked role '${SLR_NAME}'"
if aws iam get-role --role-name "${SLR_NAME}" >/dev/null 2>&1; then
  echo "  ✅ ${SLR_NAME} present"
else
  echo "  [create] ${SLR_NAME} not present; creating explicitly"
  CREATE_SLR_STDERR=$(mktemp)
  if aws iam create-service-linked-role \
      --aws-service-name controltower.amazonaws.com \
      2>"${CREATE_SLR_STDERR}"; then
    rm -f "${CREATE_SLR_STDERR}"
    echo "    ✅ created"
  else
    ERR=$(cat "${CREATE_SLR_STDERR}")
    rm -f "${CREATE_SLR_STDERR}"
    # InvalidInput / AlreadyExists both mean the SLR effectively exists; anything else is fatal.
    if echo "${ERR}" | grep -qE "InvalidInput|AlreadyExists"; then
      echo "    ℹ️  ${SLR_NAME} already exists (continuing)"
    else
      echo "    ❌ create-service-linked-role failed for ${SLR_NAME}" >&2
      echo "    AWS error: ${ERR}" >&2
      exit 1
    fi
  fi
fi

echo "All AWS Organizations trusted-access prerequisites are in place."
