import { z } from 'zod';

const EXPECTED_PERMISSION_SET_COUNT = 10;
const PERMISSION_SET_NAME_PATTERN = /^[A-Za-z0-9]+-PS$/;
const AWS_MANAGED_POLICY_NAME_PATTERN = /^[A-Za-z0-9+=,.@_/-]{1,128}$/;
const GROUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const ACCESS_LEVELS = [
  'admin',
  'limited-admin',
  'power-user',
  'deploy',
  'security-admin',
  'logging-admin',
  'kms-admin',
  'network-admin',
  'read-only',
  'read-validate',
  'limited-operator',
  'scoped-admin'
] as const;

const PRODUCTION_ACCESS_MODES = ['jit-only', 'read-only', 'narrowly-scoped', 'not-applicable'] as const;
export const APPROVED_PERMISSION_SET_NAMES = [
  'PlatformAdmin-PS',
  'PlatformEngineer-PS',
  'ComplianceReadOnly-PS',
  'SecurityReadOnly-PS',
  'SecurityAdmin-PS',
  'NetworkAdmin-PS',
  'KMSAdmin-PS',
  'LoggingAdmin-PS',
  'WorkloadAdmin-PS',
  'ReadOnly-PS'
] as const;
const PROVISIONAL_MANAGED_POLICIES: Record<(typeof APPROVED_PERMISSION_SET_NAMES)[number], readonly string[]> = {
  'PlatformAdmin-PS': ['AdministratorAccess'],
  'PlatformEngineer-PS': ['PowerUserAccess'],
  'ComplianceReadOnly-PS': ['ReadOnlyAccess'],
  'SecurityReadOnly-PS': ['SecurityAudit'],
  'SecurityAdmin-PS': ['SecurityAudit'],
  'NetworkAdmin-PS': ['job-function/NetworkAdministrator'],
  'KMSAdmin-PS': ['AWSKeyManagementServicePowerUser'],
  'LoggingAdmin-PS': ['CloudWatchLogsFullAccess'],
  'WorkloadAdmin-PS': ['PowerUserAccess'],
  'ReadOnly-PS': ['ReadOnlyAccess']
};

export const PermissionSetNameSchema = z.string().regex(PERMISSION_SET_NAME_PATTERN);
export const AwsManagedPolicyNameSchema = z.string().regex(AWS_MANAGED_POLICY_NAME_PATTERN);
export const PermissionSetAccessLevelSchema = z.enum(ACCESS_LEVELS);
export const PermissionSetProductionAccessSchema = z.enum(PRODUCTION_ACCESS_MODES);

// Standard session duration is one hour; PT8H is an approved exception for read-only access only
// (see landing-zone-identity-center-governance.instructions.md - "unless an approved exception").
const APPROVED_SESSION_DURATIONS = ['PT1H', 'PT8H'] as const;
export const PermissionSetSessionDurationSchema = z.enum(APPROVED_SESSION_DURATIONS);

export const PermissionSetDefinitionSchema = z
  .object({
    name: PermissionSetNameSchema,
    purpose: z.string().min(1),
    accessLevel: PermissionSetAccessLevelSchema,
    productionAccess: PermissionSetProductionAccessSchema,
    sessionDuration: PermissionSetSessionDurationSchema,
    managedPolicies: z.array(AwsManagedPolicyNameSchema).min(1)
  })
  .strict();

export const GroupPermissionMappingSchema = z
  .object({
    groupName: z.string().regex(GROUP_NAME_PATTERN),
    permissionSetName: PermissionSetNameSchema
  })
  .strict();

export const AccountAssignmentDefinitionSchema = z
  .object({
    groupName: z.string().regex(GROUP_NAME_PATTERN),
    permissionSetName: PermissionSetNameSchema,
    accountId: z.string().regex(AWS_ACCOUNT_ID_PATTERN)
  })
  .strict();

export const ScimSyncSchema = z
  .object({
    checkForScimSync: z.number().int().positive(),
    queryAccountAssignmentStatus: z.number().int().positive()
  })
  .strict();

export const ScimCleanupSchema = z
  .object({
    checkForScimCleanup: z.number().int().positive()
  })
  .strict();

// Matches the IAM Identity Center `sso-admin update-instance --name` constraints (max 255, [\w+=,.@-]+).
const INSTANCE_NAME_PATTERN = /^[\w+=,.@-]+$/;
export const InstanceNameSchema = z.string().min(1).max(255).regex(INSTANCE_NAME_PATTERN);

export const IdentityCenterSchema = z
  .object({
    instanceName: InstanceNameSchema,
    permissionSets: z.array(PermissionSetDefinitionSchema).length(EXPECTED_PERMISSION_SET_COUNT),
    groupMappings: z.array(GroupPermissionMappingSchema).default([]),
    accountAssignments: z.array(AccountAssignmentDefinitionSchema).default([]),
    scim: ScimSyncSchema,
    scimCleanup: ScimCleanupSchema
  })
  .strict()
  .superRefine((configuration, context) => {
    const names = configuration.permissionSets.map((permissionSet) => permissionSet.name);
    const actualNames = new Set(names);

    if (actualNames.size !== names.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionSets'],
        message: 'permission set names must be unique'
      });
    }

    const expectedNames = new Set<string>(APPROVED_PERMISSION_SET_NAMES);
    if (names.some((name) => !expectedNames.has(name)) || expectedNames.size !== actualNames.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionSets'],
        message: 'permission sets must match the approved catalogue exactly'
      });
    }

    configuration.permissionSets.forEach((permissionSet, index) => {
      const expectedPolicies =
        PROVISIONAL_MANAGED_POLICIES[permissionSet.name as keyof typeof PROVISIONAL_MANAGED_POLICIES];
      const actualPolicies = new Set(permissionSet.managedPolicies);
      if (
        expectedPolicies === undefined ||
        actualPolicies.size !== permissionSet.managedPolicies.length ||
        actualPolicies.size !== expectedPolicies.length ||
        expectedPolicies.some((policy) => !actualPolicies.has(policy))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['permissionSets', index, 'managedPolicies'],
          message: 'managed policies must match the approved provisional baseline'
        });
      }
    });

    const platformAdmin = configuration.permissionSets.find(
      (permissionSet) => permissionSet.name === 'PlatformAdmin-PS'
    );
    if (platformAdmin?.productionAccess !== 'jit-only') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionSets'],
        message: 'PlatformAdmin-PS must be JIT-only in Production'
      });
    }

    const permissionSetNames = new Set(names);
    const mappingKeys = new Set(
      configuration.groupMappings.map((mapping) => `${mapping.groupName}::${mapping.permissionSetName}`)
    );
    if (mappingKeys.size !== configuration.groupMappings.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupMappings'],
        message: 'group mappings must be unique'
      });
    }

    const assignmentKeys = new Set(
      configuration.accountAssignments.map(
        (assignment) => `${assignment.groupName}::${assignment.permissionSetName}::${assignment.accountId}`
      )
    );
    if (assignmentKeys.size !== configuration.accountAssignments.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountAssignments'],
        message: 'account assignments must be unique'
      });
    }

    configuration.groupMappings.forEach((mapping, index) => {
      if (!permissionSetNames.has(mapping.permissionSetName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groupMappings', index, 'permissionSetName'],
          message: 'group mapping references an undefined permission set'
        });
      }
    });

    configuration.accountAssignments.forEach((assignment, index) => {
      const mappingKey = `${assignment.groupName}::${assignment.permissionSetName}`;
      if (!mappingKeys.has(mappingKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountAssignments', index],
          message: 'account assignment requires a matching group mapping'
        });
      }
    });
  });

export type IdentityCenterConfig = z.infer<typeof IdentityCenterSchema>;
export type PermissionSetDefinition = z.infer<typeof PermissionSetDefinitionSchema>;
export type PermissionSetName = z.infer<typeof PermissionSetNameSchema>;
export type GroupPermissionMapping = z.infer<typeof GroupPermissionMappingSchema>;
export type AccountAssignmentDefinition = z.infer<typeof AccountAssignmentDefinitionSchema>;
