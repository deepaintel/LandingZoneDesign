import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const ssoAdminClientMock = vi.hoisted(() => vi.fn().mockName('ssoAdminClientMock'));
const captureAwsV3ClientMock = vi.hoisted(() => vi.fn().mockName('captureAwsV3ClientMock'));
const listInstancesCommandMock = vi.hoisted(() => vi.fn().mockName('listInstancesCommandMock'));
const describePermissionSetCommandMock = vi.hoisted(() => vi.fn().mockName('describePermissionSetCommandMock'));
const createAccountAssignmentCommandMock = vi.hoisted(() => vi.fn().mockName('createAccountAssignmentCommandMock'));
const describeAssignmentStatusCommandMock = vi.hoisted(() => vi.fn().mockName('describeAssignmentStatusCommandMock'));
const paginateListPermissionSetsMock = vi.hoisted(() => vi.fn().mockName('paginateListPermissionSetsMock'));

const tracer = {
  captureAWSv3Client: captureAwsV3ClientMock
};

describe('identity center SSO helper', () => {
  let cut: typeof import('./identity-center-sso-helper.js');

  beforeEach(async () => {
    process.env.REGION = 'REGION';
    ssoAdminClientMock.mockImplementation(() => ({ send: sendMock }));
    captureAwsV3ClientMock.mockImplementation((client) => client);

    vi.mock('@aws-sdk/client-sso-admin', () => ({
      SSOAdminClient: ssoAdminClientMock,
      ListInstancesCommand: listInstancesCommandMock,
      DescribePermissionSetCommand: describePermissionSetCommandMock,
      CreateAccountAssignmentCommand: createAccountAssignmentCommandMock,
      DescribeAccountAssignmentCreationStatusCommand: describeAssignmentStatusCommandMock,
      paginateListPermissionSets: paginateListPermissionSetsMock,
      StatusValues: {
        FAILED: 'FAILED',
        IN_PROGRESS: 'IN_PROGRESS',
        SUCCEEDED: 'SUCCEEDED'
      }
    }));

    cut = await import('./identity-center-sso-helper.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('@aws-sdk/client-sso-admin');
  });

  it('creates and traces the SSO Admin client with retry settings', () => {
    cut.createIdentityCenterSsoClient(tracer as never);

    expect(ssoAdminClientMock).toHaveBeenCalledWith({
      region: 'REGION',
      maxAttempts: 10,
      retryMode: 'standard'
    });
    expect(captureAwsV3ClientMock).toHaveBeenCalledOnce();
  });

  it('maps Identity Center instances', async () => {
    sendMock.mockResolvedValue({
      Instances: [{ IdentityStoreId: 'store-id', InstanceArn: 'instance-arn' }]
    });
    const client = cut.createIdentityCenterSsoClient(tracer as never);

    await expect(client.listInstances()).resolves.toEqual([
      { identityStoreId: 'store-id', instanceArn: 'instance-arn' }
    ]);
    expect(listInstancesCommandMock).toHaveBeenCalledWith({});
  });

  it('collects permission set ARNs across pages', async () => {
    paginateListPermissionSetsMock.mockImplementation(async function* () {
      yield { PermissionSets: ['arn-1'] };
      yield { PermissionSets: ['arn-2'] };
    });
    const client = cut.createIdentityCenterSsoClient(tracer as never);

    await expect(client.listPermissionSetArns('instance-arn')).resolves.toEqual(['arn-1', 'arn-2']);
    expect(paginateListPermissionSetsMock).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 20 }), {
      InstanceArn: 'instance-arn'
    });
  });

  it('describes a permission set', async () => {
    sendMock.mockResolvedValue({ PermissionSet: { Name: 'ReadOnly-PS', PermissionSetArn: 'permission-set-arn' } });
    const client = cut.createIdentityCenterSsoClient(tracer as never);

    await expect(client.describePermissionSet('instance-arn', 'permission-set-arn')).resolves.toEqual({
      name: 'ReadOnly-PS',
      arn: 'permission-set-arn'
    });
    expect(describePermissionSetCommandMock).toHaveBeenCalledWith({
      InstanceArn: 'instance-arn',
      PermissionSetArn: 'permission-set-arn'
    });
  });

  it('creates an account assignment and returns its request ID', async () => {
    sendMock.mockResolvedValue({ AccountAssignmentCreationStatus: { RequestId: 'request-id' } });
    const client = cut.createIdentityCenterSsoClient(tracer as never);
    const input = {
      InstanceArn: 'instance-arn',
      TargetId: '123456789012',
      TargetType: 'AWS_ACCOUNT' as const,
      PermissionSetArn: 'permission-set-arn',
      PrincipalType: 'GROUP' as const,
      PrincipalId: 'group-id'
    };

    await expect(client.createAccountAssignment(input)).resolves.toBe('request-id');
    expect(createAccountAssignmentCommandMock).toHaveBeenCalledWith(input);
  });

  it('maps known assignment statuses and ignores unknown values', async () => {
    const client = cut.createIdentityCenterSsoClient(tracer as never);

    sendMock.mockResolvedValueOnce({ AccountAssignmentCreationStatus: { Status: 'IN_PROGRESS' } });
    await expect(client.getAccountAssignmentStatus('instance-arn', 'request-id')).resolves.toEqual({
      status: 'IN_PROGRESS',
      failureReason: undefined
    });

    sendMock.mockResolvedValueOnce({ AccountAssignmentCreationStatus: { Status: 'UNKNOWN' } });
    await expect(client.getAccountAssignmentStatus('instance-arn', 'request-id')).resolves.toEqual({
      failureReason: undefined
    });
    expect(describeAssignmentStatusCommandMock).toHaveBeenCalledWith({
      InstanceArn: 'instance-arn',
      AccountAssignmentCreationRequestId: 'request-id'
    });
  });

  it('surfaces the failure reason when assignment creation fails', async () => {
    const client = cut.createIdentityCenterSsoClient(tracer as never);

    sendMock.mockResolvedValueOnce({
      AccountAssignmentCreationStatus: { Status: 'FAILED', FailureReason: 'PermissionSet not provisioned' }
    });
    await expect(client.getAccountAssignmentStatus('instance-arn', 'request-id')).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'PermissionSet not provisioned'
    });
  });
});
