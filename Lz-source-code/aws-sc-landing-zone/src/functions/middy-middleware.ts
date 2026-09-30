import type { MiddlewareObj, Request } from '@middy/core';
import middy from '@middy/core';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { z } from 'zod';

type MiddlewareRequest = Request<unknown, unknown, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Custom Middy middleware to validate the response using Zod
const responseValidator = (responseSchema: z.ZodTypeAny): MiddlewareObj => ({
  after: async (request: MiddlewareRequest) => {
    try {
      responseSchema.parse(request.response);
    } catch (err) {
      // Optionally log the error or throw a custom error
      throw new Error('Response validation failed: ' + (err instanceof Error ? err.message : String(err)), {
        cause: err
      });
    }
  }
});

// Custom Middy middleware to handle input event validation errors after parser
const inputValidationErrorHandler = (): MiddlewareObj => ({
  onError: async (request: MiddlewareRequest) => {
    throw request.error;
  }
});

const correlationIdMiddleware = (logger: Logger): MiddlewareObj => ({
  before: async (request: MiddlewareRequest) => {
    if (isRecord(request.event) && typeof request.event.correlationId === 'string') {
      logger.setCorrelationId(request.event.correlationId);
    }
  }
});

export function createFunctionHandler<TEvent, TResult>(
  handler: (event: TEvent) => Promise<TResult>,
  inputSchema: z.ZodType<TEvent>,
  outputSchema: z.ZodType<TResult>,
  logger: Logger,
  tracer: Tracer
) {
  return middy(handler)
    .use(parser({ schema: inputSchema }))
    .use(inputValidationErrorHandler())
    .use(correlationIdMiddleware(logger))
    .use(responseValidator(outputSchema))
    .use(captureLambdaHandler(tracer))
    .use(injectLambdaContext(logger, { logEvent: false, flushBufferOnUncaughtError: true }));
}

// Export the middleware functions
export { responseValidator, inputValidationErrorHandler };
