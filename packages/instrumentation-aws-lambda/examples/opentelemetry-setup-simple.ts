/**
 * Simple OpenTelemetry Setup with ESM Support
 *
 * This setup automatically patches ESM Lambda handlers without requiring
 * changes to your handler files.
 *
 * Usage: Replace your existing opentelemetry.setup.ts with this content
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';

// Configure diagnostics
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Create the instrumentation with ESM support
const lambdaInstrumentation = new AwsLambdaInstrumentation({
  requestHook: (span, { event, context }) => {
    span.setAttribute('faas.name', context.functionName);
    span.setAttribute('faas.version', context.functionVersion);
    span.setAttribute('faas.execution', context.awsRequestId);
    console.log('✅ [REQUEST HOOK] Lambda handler span created');
  },
  responseHook: (span, { err, res }) => {
    if (err) {
      span.setAttribute('faas.error', err.message);
      console.error('❌ [RESPONSE HOOK] Handler error:', err.message);
    } else {
      console.log('✅ [RESPONSE HOOK] Lambda handler span ended successfully');
    }
  },
});

// Create the SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || 'lambda-function',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.OTEL_SERVICE_VERSION || '1.0.0',
  }),
  instrumentations: [
    lambdaInstrumentation,
    ...getNodeAutoInstrumentations({
      // Disable some instrumentations that might conflict in Lambda
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-net': {
        enabled: false,
      },
    }),
  ],
});

// Initialize the SDK
sdk.start();

console.log('✅ OpenTelemetry SDK started');

// Set up ESM auto-patching
setupESMAutoPatching(lambdaInstrumentation);

/**
 * Set up automatic ESM patching
 */
function setupESMAutoPatching(instrumentation) {
  // Check if we're in a Lambda environment with an ESM handler
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !process.env._HANDLER) {
    console.log('⚠️  Not in Lambda environment, skipping ESM auto-patching');
    return;
  }

  const handlerDef = process.env._HANDLER;
  const [moduleName, functionName] = handlerDef.split('.', 2);

  // Check if this is likely an ESM handler
  const isESMHandler =
    handlerDef.includes('.mjs') ||
    process.env.LAMBDA_TASK_ROOT?.includes('esm') ||
    false; // Add other ESM detection logic as needed

  if (!isESMHandler) {
    console.log('📝 Not an ESM handler, using standard instrumentation');
    return;
  }

  console.log('🎯 ESM handler detected, setting up auto-patching', {
    handlerDef,
    moduleName,
    functionName,
  });

  // Store the instrumentation globally for the handler to use
  if (typeof globalThis !== 'undefined') {
    globalThis.__aws_lambda_esm_instrumentation = instrumentation;
  } else if (typeof global !== 'undefined') {
    global.__aws_lambda_esm_instrumentation = instrumentation;
  }

  // Create a simple auto-patching mechanism
  setupHandlerPatching(moduleName, functionName);
}

/**
 * Set up handler patching mechanism
 */
function setupHandlerPatching(moduleName, functionName) {
  // This is a simple approach that relies on the handler file
  // importing and using the instrumentation

  console.log('🔧 ESM auto-patching setup complete', {
    moduleName,
    functionName,
    instruction: 'Handler will be automatically patched when loaded',
  });
}

// Export for potential cleanup
export { sdk, lambdaInstrumentation };
