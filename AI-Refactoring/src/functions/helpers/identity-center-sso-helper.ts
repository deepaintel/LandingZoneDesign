import {
  CreateAccountAssignmentCommand,
  DescribeAccountAssignmentCreationStatusCommand,
  DescribePermissionSetCommand,
  ListInstancesCommand,
  paginateListPermissionSets,
  SSOAdminClient,
  SSOAdminPaginationConfiguration,
  StatusValues
} from '@aws-sdk/client-sso-admin';
import type { Tracer } from '@aws-lambda-powertools/tracer';
import process from 'node:process';

export interface IdentityCenterInstance {
  readonly identityStoreId?: string;
  readonly instanceArn?: string;
}

export interface PermissionSetDescription {
  readonly name?: string;
  readonly arn?: string;
}

export type AccountAssignmentStatus = 'FAILED' | 'IN_PROGRESS' | 'SUCCEEDED';

export interface AccountAssignmentStatusResult {
  readonly status?: AccountAssignmentStatus;
  readonly failureReason?: string;
}

export interface IdentityCenterSsoClient {
  listInstances(): Promise<IdentityCenterInstance[]>;
  listPermissionSetArns(instanceArn: string): Promise<string[]>;
  describePermissionSet(instanceArn: string, permissionSetArn: string): Promise<PermissionSetDescription>;
  createAccountAssignment(input: AccountAssignmentRequest): Promise<string | undefined>;
  getAccountAssignmentStatus(instanceArn: string, requestId: string): Promise<AccountAssignmentStatusResult>;
}

export interface AccountAssignmentRequest {
  readonly InstanceArn: string;
  readonly TargetId: string;
  readonly TargetType: 'AWS_ACCOUNT';
  readonly PermissionSetArn: string;
  readonly PrincipalType: 'GROUP';
  readonly PrincipalId: string;
}

export function createIdentityCenterSsoClient(tracer: Tracer): IdentityCenterSsoClient {
  const client = tracer.captureAWSv3Client(
    new SSOAdminClient({
      region: process.env.REGION,
      maxAttempts: 10,
      retryMode: 'standard'
    })
  );

  return {
    async listInstances() {
      const response = await client.send(new ListInstancesCommand({}));
      return (response.Instances ?? []).map((instance) => ({
        identityStoreId: instance.IdentityStoreId,
        instanceArn: instance.InstanceArn
      }));
    },

    async listPermissionSetArns(instanceArn) {
      const configuration: SSOAdminPaginationConfiguration = { client, pageSize: 20 };
      const permissionSetArns: string[] = [];
      for await (const page of paginateListPermissionSets(configuration, { InstanceArn: instanceArn })) {
        permissionSetArns.push(...(page.PermissionSets ?? []));
      }
      return permissionSetArns;
    },

    async describePermissionSet(instanceArn, permissionSetArn) {
      const response = await client.send(
        new DescribePermissionSetCommand({ InstanceArn: instanceArn, PermissionSetArn: permissionSetArn })
      );
      return {
        name: response.PermissionSet?.Name,
        arn: response.PermissionSet?.PermissionSetArn
      };
    },

    async createAccountAssignment(input) {
      const response = await client.send(new CreateAccountAssignmentCommand(input));
      return response.AccountAssignmentCreationStatus?.RequestId;
    },

    async getAccountAssignmentStatus(instanceArn, requestId) {
      const response = await client.send(
        new DescribeAccountAssignmentCreationStatusCommand({
          InstanceArn: instanceArn,
          AccountAssignmentCreationRequestId: requestId
        })
      );
      const status = response.AccountAssignmentCreationStatus?.Status;
      const failureReason = response.AccountAssignmentCreationStatus?.FailureReason;
      if (status === StatusValues.FAILED || status === StatusValues.IN_PROGRESS || status === StatusValues.SUCCEEDED) {
        return { status, failureReason };
      }
      return { failureReason };
    }
  };
}
