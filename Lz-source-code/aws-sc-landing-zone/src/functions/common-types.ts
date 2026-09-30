import { z } from 'zod';

const commonSchemaFields = z.object({
  correlationId: z.string().optional(),
  verbosityLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional()
});

const accountIdSchema = z.string().regex(/^[0-9]{12}$/);

type commonFieldsType = z.infer<typeof commonSchemaFields>;

export { commonSchemaFields, accountIdSchema, type commonFieldsType };
