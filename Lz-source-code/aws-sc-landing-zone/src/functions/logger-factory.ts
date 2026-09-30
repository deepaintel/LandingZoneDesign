import { Logger } from '@aws-lambda-powertools/logger';
import process from 'node:process';

/**
 * Creates a logger instance for a specific service.
 *
 * By default log buffering is enabled. This is controlled
 * by the environment variable POWERTOOLS_LOGGER_BUFFERING.
 *
 * If the environment variable is not set or set to any other
 * value than "false" buffering will be enabled.
 *
 * @param serviceName The name of the service.
 * @returns A logger instance.
 */
export function createLogger(serviceName: string): Logger {
  let enableLogBuffering: boolean = true;

  const powertoolsLogBuffering = process.env.POWERTOOLS_LOGGER_BUFFERING;
  if (powertoolsLogBuffering && powertoolsLogBuffering === 'false') {
    enableLogBuffering = false;
  }

  return new Logger({
    serviceName,
    logBufferOptions: enableLogBuffering
      ? {
          bufferAtVerbosity: 'INFO',
          flushOnErrorLog: true
        }
      : undefined // disable log buffering
  });
}
