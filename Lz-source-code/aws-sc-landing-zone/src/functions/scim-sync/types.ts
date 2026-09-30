import { z } from 'zod';

import { accountIdSchema } from '../common-types.js';

export const identityStoreInfoSchema = z
  .object({
    instanceId: z.string().min(1),
    instanceArn: z.string().min(1)
  })
  .strict();

export const groupResponseSchema = z
  .object({
    accountId: accountIdSchema,
    permissionSetName: z.string().min(1),
    groupId: z.string().min(1),
    description: z.string().min(1)
  })
  .strict();

export type GroupResponse = z.infer<typeof groupResponseSchema>;
