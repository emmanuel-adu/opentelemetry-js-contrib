/**
 * CommonJS Setup for Custom AWS Lambda Instrumentation
 * This script initializes the instrumentation for CommonJS handlers
 */

const {
  CustomAwsLambdaInstrumentation,
} = require('./build/src/instrumentation');

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

// Store reference globally for interceptors to access
globalThis.__aws_lambda_esm_instrumentation = instrumentation;

// Initialize the instrumentation
instrumentation.init();

console.log(
  '✅ [CommonJS Setup] Custom AWS Lambda instrumentation initialized'
);
