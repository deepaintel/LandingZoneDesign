#!/bin/bash
# Create cross-account inspection role in Audit and Log Archive accounts
# for pre-initialization Config/CloudTrail conflict checking
#
# This script should be called from the GitHub Actions workflow:
#   .github/actions/initialize-control-tower/action.yml
#
# Usage:
#   ./create-inspection-role.sh <target-account-id> <role-name> <management-account-id> [aws-region]
#
# Arguments:
#   target-account-id:      The account where the role will be created (Audit or Log Archive)
#   role-name:              Name of the inspection role (e.g., LZ-PreInit-Inspection)
#   management-account-id:  The management account that will assume this role
#   aws-region:             AWS region (default: eusc-de-east-1)
#
# Prerequisites:
#   - Target accounts must be created via AWS Organizations (OrganizationAccountAccessRole
#     is automatically provisioned by AWS when member accounts are created)

set -euo pipefail

TARGET_ACCOUNT_ID="${1:?Target account ID is required}"
ROLE_NAME="${2:?Role name is required}"
MANAGEMENT_ACCOUNT_ID="${3:?Management account ID is required}"
AWS_REGION="${4:-eusc-de-east-1}"

echo "Creating inspection role '$ROLE_NAME' in account '$TARGET_ACCOUNT_ID'"
echo "  Target account:       $TARGET_ACCOUNT_ID"
echo "  Role name:            $ROLE_NAME"
echo "  Management account:   $MANAGEMENT_ACCOUNT_ID"
echo "  Region:               $AWS_REGION"

# Assume OrganizationAccountAccessRole in the target account
# AWS automatically creates this role in member accounts created via AWS Organizations
# The management account root can assume this role in any member account
echo "  Assuming OrganizationAccountAccessRole in target account..."
ASSUME_ROLE_RESPONSE=$(aws sts assume-role \
  --role-arn "arn:aws-eusc:iam::${TARGET_ACCOUNT_ID}:role/OrganizationAccountAccessRole" \
  --role-session-name "lz-inspection-role-creation" \
  --duration-seconds 900 \
  --region "$AWS_REGION")

# Extract temporary credentials from the assume-role response
export AWS_ACCESS_KEY_ID=$(echo "$ASSUME_ROLE_RESPONSE" | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo "$ASSUME_ROLE_RESPONSE" | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo "$ASSUME_ROLE_RESPONSE" | jq -r '.Credentials.SessionToken')

echo "  ✅ Successfully assumed role in target account $TARGET_ACCOUNT_ID"

# Trust policy allowing the management account to assume the role
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws-eusc:iam::${MANAGEMENT_ACCOUNT_ID}:root"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)

# Permission policy for Config and CloudTrail read operations
PERMISSION_POLICY=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DescribeConfigRecorders",
      "Effect": "Allow",
      "Action": [
        "config:DescribeConfigurationRecorders",
        "config:DescribeDeliveryChannels"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DescribeCloudTrailTrails",
      "Effect": "Allow",
      "Action": [
        "cloudtrail:DescribeTrails",
        "cloudtrail:ListTrails"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

# Create role in the target account using assumed role credentials
# Capture stderr to inspect specific error types instead of masking all failures
echo "  Creating IAM role in target account..."
CREATE_ROLE_STDERR=$(mktemp)
if aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --region "$AWS_REGION" \
    2>"$CREATE_ROLE_STDERR"; then
  echo "  ✅ Role created successfully"
  rm -f "$CREATE_ROLE_STDERR"
else
  CREATE_ROLE_ERROR=$(cat "$CREATE_ROLE_STDERR")
  rm -f "$CREATE_ROLE_STDERR"
  # Only tolerate EntityAlreadyExists; propagate any other error
  if echo "$CREATE_ROLE_ERROR" | grep -q "EntityAlreadyExists"; then
    echo "  ℹ️  Role '$ROLE_NAME' already exists in account $TARGET_ACCOUNT_ID (continuing...)"
  else
    echo "  ❌ Failed to create role '$ROLE_NAME' in account $TARGET_ACCOUNT_ID" >&2
    echo "  AWS error: $CREATE_ROLE_ERROR" >&2
    exit 1
  fi
fi

# Attach permission policy
echo "  Attaching permission policy..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "${ROLE_NAME}-policy" \
  --policy-document "$PERMISSION_POLICY" \
  --region "$AWS_REGION"

# Verify role was created
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --region "$AWS_REGION" --query 'Role.Arn' --output text)
echo "  ✅ Inspection role created successfully in account $TARGET_ACCOUNT_ID"
echo "     Role ARN: $ROLE_ARN"
echo "     Role Name: $ROLE_NAME"

# Clear temporary credentials to avoid credential leakage
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
