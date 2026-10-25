import { z } from 'zod';
import { accountIdSchema, commonSchemaFields } from './../../common-types.js';
import { groupResponseSchema, identityStoreInfoSchema } from '../types.js';

const assignmentStatusSchema = z.enum(['FAILED', 'IN_PROGRESS', 'SUCCEEDED']);

const lambdaInputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z
      .object({
        allAccountIds: z.array(accountIdSchema),
        identityStoreInfo: identityStoreInfoSchema,
        allGroups: z.array(groupResponseSchema),
        allPermissionSets: z.record(z.string().min(1), z.string().min(1)),
        assignmentRequestId: z.string().min(1)
      })
      .strict(),
    status: z
      .object({
        assignmentsDone: z.literal(false),
        assignmentStatus: assignmentStatusSchema.optional()
      })
      .strict()
  })
  .strict();

type LambdaInputEvent = z.infer<typeof lambdaInputEventSchema>;

const lambdaOutputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z
      .object({
        allAccountIds: z.array(accountIdSchema),
        identityStoreInfo: identityStoreInfoSchema,
        allGroups: z.array(groupResponseSchema),
        allPermissionSets: z.record(z.string().min(1), z.string().min(1)),
        assignmentRequestId: z.string().min(1)
      })
      .strict(),
    status: z
      .object({
        assignmentsDone: z.literal(false),
        assignmentStatus: assignmentStatusSchema
      })
      .strict()
  })
  .strict();

type LambdaOutputEvent = z.infer<typeof lambdaOutputEventSchema>;

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
