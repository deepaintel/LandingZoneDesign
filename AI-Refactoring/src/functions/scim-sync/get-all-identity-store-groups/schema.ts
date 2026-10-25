import { z } from 'zod';
import { accountIdSchema, commonSchemaFields } from './../../common-types.js';
import { groupResponseSchema, identityStoreInfoSchema } from '../types.js';

const lambdaInputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z
      .object({
        allAccountIds: z.array(accountIdSchema),
        identityStoreInfo: identityStoreInfoSchema
      })
      .strict()
  })
  .strict();

type LambdaInputEvent = z.infer<typeof lambdaInputEventSchema>;

const lambdaOutputEventSchema = commonSchemaFields
  .extend({
    output: z
      .object({
        allAccountIds: z.array(accountIdSchema),
        identityStoreInfo: identityStoreInfoSchema,
        allGroups: z.array(groupResponseSchema)
      })
      .strict()
  })
  .strict();

type LambdaOutputEvent = z.infer<typeof lambdaOutputEventSchema>;

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
