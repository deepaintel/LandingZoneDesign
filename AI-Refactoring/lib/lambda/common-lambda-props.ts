import * as cdk from 'aws-cdk-lib';
import * as nodejsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { __rootDirname } from '../../scripts/esm-extensions.js';
import path from 'node:path';

const COMMON_ENVIRONMENT: Record<string, string> = {
  POWERTOOLS_LOG_LEVEL: 'INFO',
  POWERTOOLS_LOGGER_BUFFERING: 'true'
};

// esbuild ESM output has no require(); shim it so bundled CJS dependencies resolve.
const CREATE_REQUIRE_BANNER = [
  "import { createRequire as __createRequire } from 'module';",
  'const require = __createRequire(import.meta.url);'
].join(' ');

const COMMON_BUNDLING_PROPS: nodejsLambda.BundlingOptions = {
  minify: true,
  keepNames: false,
  sourceMap: true,
  tsconfig: path.join(__rootDirname, 'tsconfig.lambda.json'),
  format: nodejsLambda.OutputFormat.ESM,
  target: 'node24',
  forceDockerBundling: false,
  banner: CREATE_REQUIRE_BANNER
};

export function createCommonLambdaProps(
  overrides: nodejsLambda.NodejsFunctionProps = {}
): nodejsLambda.NodejsFunctionProps {
  const { bundling, environment, ...otherOverrides } = overrides;

  return {
    runtime: lambda.Runtime.NODEJS_24_X,
    memorySize: 1024,
    timeout: cdk.Duration.minutes(1),
    tracing: lambda.Tracing.ACTIVE,
    ...otherOverrides,
    bundling: {
      ...COMMON_BUNDLING_PROPS,
      ...bundling
    },
    environment: {
      ...COMMON_ENVIRONMENT,
      ...environment
    }
  };
}

export const GENERAL_LAMBDA_PROPS = createCommonLambdaProps();
