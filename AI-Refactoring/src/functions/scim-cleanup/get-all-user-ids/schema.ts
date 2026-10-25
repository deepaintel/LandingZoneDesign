import { z } from 'zod';
import { commonFieldsType, commonSchemaFields } from './../../common-types.js';

const lambdaInputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z.object({
      identityStoreInfo: z.object({
        instanceId: z.string()
      })
    })
  })
  .strict();

type LambdaInputEvent = commonFieldsType & {
  output: {
    identityStoreInfo: {
      instanceId: string;
    };
  };
};

const lambdaOutputEventSchema = z
  .object({
    ...commonSchemaFields.shape,
    output: z.object({
      identityStoreInfo: z.object({
        instanceId: z.string()
      }),
      userIds: z.array(
        z.object({
          correlationId: z.string(),
          output: z.object({
            instanceId: z.string(),
            userId: z.string()
          })
        })
      )
    })
  })
  .strict();

type LambdaOutputEvent = LambdaInputEvent & {
  output: {
    identityStoreInfo: {
      instanceId: string;
    };
    userIds: {
      correlationId: string;
      output: {
        instanceId: string;
        userId: string;
      };
    }[];
  };
};

export { type LambdaInputEvent, type LambdaOutputEvent, lambdaInputEventSchema, lambdaOutputEventSchema };
