import { z } from 'zod';
import { accountIdSchema, commonSchemaFields } from './../../common-types.js';
import { groupResponseSchema, identityStoreInfoSchema } from '../types.js';

const assignmentOutputFields = {
  allAccountIds: z.array(accountIdSchema),
  identityStoreInfo: identityStoreInfoSchema,
  allGroups: z.array(groupResponseSchema),
  allPermissionSets: z.record(z.string().min(1), z.string().min(1))
};

const assignmentOutputSchema = z.object(assignmentOutputFields).strict();

const validateAssignmentOutput = (output: z.infer<typeof assignmentOutputSchema>, context: z.RefinementCtx) => {
  output.allGroups.forEach((group, index) => {
    if (!output.allAccountIds.includes(group.accountId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allGroups', index, 'accountId'],
        message: 'group account ID must be present in allAccountIds'
      });
    }
    if (!output.allPermissionSets[group.permissionSetName]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allGroups', index, 'permissionSetName'],
        message: 'group permission set must exist in allPermissionSets'
      });
    }
  });
};

const assignmentInputOutputSchema = assignmentOutputSchema
  .extend({ assignmentRequestId: z.string().min(1).optional() })
  .superRefine(validateAssignmentOutput);

const assignmentStatusSchema = z
  .object({
    assignmentsDone: z.boolean()
  })
  .strict();

// The Step Functions loop feeds get-account-assignment-status's output back into this Lambda
// once an assignment is no longer IN_PROGRESS, so the input status may carry assignmentStatus.
const inputAssignmentStatusSchema = assignmentStatusSchema.extend({
  assignmentStatus: z.enum(['FAILED', 'IN_PROGRESS', 'SUCCEEDED']).optional()
});

const lambdaInputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: assignmentInputOutputSchema,
    status: inputAssignmentStatusSchema.optional()
  })
  .strict();

type LambdaInputEvent = z.infer<typeof lambdaInputEventSchema>;

const lambdaOutputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: assignmentOutputSchema
      .extend({ assignmentRequestId: z.string().min(1).optional() })
      .superRefine(validateAssignmentOutput),
    status: assignmentStatusSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (!event.status.assignmentsDone && !event.output.assignmentRequestId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['output', 'assignmentRequestId'],
        message: 'assignmentRequestId is required while assignments are in progress'
      });
    }
  });

type LambdaOutputEvent = z.infer<typeof lambdaOutputEventSchema>;

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
