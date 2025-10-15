/**
 * ESM Wrapper for RIE Test
 * This wrapper loads the compiled CJS instrumentation
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load the compiled instrumentation (CJS)
const { CustomAwsLambdaInstrumentation } = require('./custom-instrumentation-compiled.cjs');

// Initialize the custom instrumentation
const instrumentation = new CustomAwsLambdaInstrumentation({
  requestHook: (span, { event, context }) => {
    console.log('✅ [CUSTOM REQUEST HOOK] Span created:', {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      functionName: context.functionName,
      requestId: context.awsRequestId,
    });
  },
  responseHook: (span, { err, res }) => {
    console.log('✅ [CUSTOM RESPONSE HOOK] Span ending:', {
      spanId: span.spanContext().spanId,
      hasError: !!err,
      statusCode: res?.statusCode,
    });
  },
});

// Store reference globally for the ESM loader to access
globalThis.__aws_lambda_esm_instrumentation = instrumentation;

// Initialize the instrumentation
instrumentation.init();

console.log('✅ [ESM Wrapper] Custom AWS Lambda instrumentation initialized');
