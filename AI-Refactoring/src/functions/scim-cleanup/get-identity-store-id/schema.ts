import { z } from 'zod';
import { commonFieldsType, commonSchemaFields } from './../../common-types.js';

const lambdaInputEventSchema = commonSchemaFields.strict();

type LambdaInputEvent = commonFieldsType;

const lambdaOutputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z.object({
      identityStoreInfo: z.object({
        instanceId: z.string()
      })
    })
  })
  .strict();

type LambdaOutputEvent = LambdaInputEvent & {
  output: {
    identityStoreInfo: {
      instanceId: string;
    };
  };
};

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
