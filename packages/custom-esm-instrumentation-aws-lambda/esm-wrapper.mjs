/**
 * ESM Wrapper for Custom AWS Lambda Instrumentation
 * This wrapper initializes the instrumentation and sets up ESM patching
 */

import { CustomAwsLambdaInstrumentation } from './src/instrumentation.js';

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
