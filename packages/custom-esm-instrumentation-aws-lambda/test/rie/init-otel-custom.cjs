// OpenTelemetry initialization with CUSTOM instrumentation for Lambda
// This runs via --require BEFORE the Lambda handler loads

const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { InMemorySpanExporter } = require('@opentelemetry/sdk-trace-base');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

// Import the CUSTOM instrumentation from examples
const { CustomAwsLambdaInstrumentation } = require('./custom-instrumentation-compiled.cjs');

// Enable debug logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

console.log('🚀 [init-otel-custom] Initializing OpenTelemetry with CUSTOM instrumentation...');
console.log('[init-otel-custom] LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT);
console.log('[init-otel-custom] _HANDLER:', process.env._HANDLER);

// Create in-memory exporter to capture spans
const memoryExporter = new InMemorySpanExporter();

// Store globally so we can access it later
global.__otelMemoryExporter = memoryExporter;

// Create CUSTOM instrumentation with hooks
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

// Create SDK with in-memory exporter
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'lambda-rie-custom-test',
  }),
  instrumentations: [instrumentation],
  spanProcessor: new SimpleSpanProcessor(memoryExporter),
});

// Start SDK
sdk.start();
console.log('✅ [init-otel-custom] OpenTelemetry SDK started');
console.log('✅ [init-otel-custom] CUSTOM AWS Lambda instrumentation enabled');

// Store SDK globally for shutdown
global.__otelSdk = sdk;

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 [init-otel-custom] Shutting down OpenTelemetry...');
  try {
    await sdk.shutdown();
    console.log('✅ [init-otel-custom] Shutdown complete');
  } catch (error) {
    console.error('❌ [init-otel-custom] Shutdown error:', error);
  }
});

console.log('✅ [init-otel-custom] Ready - Lambda handler will be instrumented with CUSTOM instrumentation');

