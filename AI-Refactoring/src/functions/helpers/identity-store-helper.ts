import {
  DeleteUserCommand,
  Group,
  GroupMembership,
  IdentitystoreClient,
  IdentitystorePaginationConfiguration,
  paginateListGroupMembershipsForMember,
  paginateListGroups,
  paginateListUsers
} from '@aws-sdk/client-identitystore';
import type { Tracer } from '@aws-lambda-powertools/tracer';
import process from 'node:process';

export interface IdentityStoreGroup {
  readonly DisplayName?: string;
  readonly GroupId?: string;
}

export interface IdentityStoreUser {
  readonly UserId?: string;
}

export interface IdentityStoreGroupMembership {
  readonly GroupId?: string;
  readonly MembershipId?: string;
}

export interface IdentityStoreClient {
  listGroups(identityStoreId: string): Promise<IdentityStoreGroup[]>;
  listUsers(identityStoreId: string): Promise<IdentityStoreUser[]>;
  listGroupMembershipsForMember(identityStoreId: string, userId: string): Promise<IdentityStoreGroupMembership[]>;
  deleteUser(identityStoreId: string, userId: string): Promise<void>;
}

export function createIdentityStoreClient(tracer: Tracer): IdentityStoreClient {
  const client = tracer.captureAWSv3Client(
    new IdentitystoreClient({
      region: process.env.REGION,
      maxAttempts: 10,
      retryMode: 'standard'
    })
  );

  return {
    async listGroups(identityStoreId) {
      const configuration: IdentitystorePaginationConfiguration = { client, pageSize: 20 };
      const groups: IdentityStoreGroup[] = [];
      for await (const page of paginateListGroups(configuration, { IdentityStoreId: identityStoreId })) {
        groups.push(
          ...(page.Groups ?? []).map((group: Group) => ({
            DisplayName: group.DisplayName,
            GroupId: group.GroupId
          }))
        );
      }
      return groups;
    },

    async listUsers(identityStoreId) {
      const configuration: IdentitystorePaginationConfiguration = { client, pageSize: 20 };
      const users: IdentityStoreUser[] = [];
      for await (const page of paginateListUsers(configuration, { IdentityStoreId: identityStoreId })) {
        users.push(...(page.Users ?? []).map((user) => ({ UserId: user.UserId })));
      }
      return users;
    },

    async listGroupMembershipsForMember(identityStoreId, userId) {
      const configuration: IdentitystorePaginationConfiguration = { client, pageSize: 20 };
      const memberships: IdentityStoreGroupMembership[] = [];
      for await (const page of paginateListGroupMembershipsForMember(configuration, {
        IdentityStoreId: identityStoreId,
        MemberId: { UserId: userId }
      })) {
        memberships.push(
          ...(page.GroupMemberships ?? []).map((membership: GroupMembership) => ({
            GroupId: membership.GroupId,
            MembershipId: membership.MembershipId
          }))
        );
      }
      return memberships;
    },

    async deleteUser(identityStoreId, userId) {
      // A resolved promise means AWS accepted the deletion; the SDK throws on any non-2xx response.
      await client.send(new DeleteUserCommand({ IdentityStoreId: identityStoreId, UserId: userId }));
    }
  };
}
