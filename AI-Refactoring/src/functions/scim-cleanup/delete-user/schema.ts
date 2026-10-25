import { z } from 'zod';
import { commonFieldsType, commonSchemaFields } from './../../common-types.js';

const lambdaInputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z.object({
      instanceId: z.string(),
      userId: z.string(),
      enabled: z.boolean()
    })
  })
  .strict();

type LambdaInputEvent = commonFieldsType & {
  output: {
    instanceId: string;
    userId: string;
    enabled: boolean;
  };
};

const lambdaOutputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z.object({
      instanceId: z.string(),
      userId: z.string(),
      enabled: z.boolean(),
      successfullyDeleted: z.boolean()
    })
  })
  .strict();

type LambdaOutputEvent = LambdaInputEvent & {
  output: {
    instanceId: string;
    userId: string;
    enabled: boolean;
    successfullyDeleted: boolean;
  };
};

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
