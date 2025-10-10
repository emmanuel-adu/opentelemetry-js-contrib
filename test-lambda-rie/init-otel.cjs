// OpenTelemetry initialization for Lambda
// This runs via --require BEFORE the Lambda handler loads

const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  AwsLambdaInstrumentation,
} = require('@opentelemetry/instrumentation-aws-lambda');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { InMemorySpanExporter } = require('@opentelemetry/sdk-trace-base');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

// Enable debug logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

console.log('🚀 [init-otel] Initializing OpenTelemetry...');
console.log('[init-otel] LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT);
console.log('[init-otel] _HANDLER:', process.env._HANDLER);

// Create in-memory exporter to capture spans
const memoryExporter = new InMemorySpanExporter();

// Store globally so we can access it later
global.__otelMemoryExporter = memoryExporter;

// Create instrumentation with hooks
const instrumentation = new AwsLambdaInstrumentation({
  requestHook: (span, { event, context }) => {
    console.log('✅ [REQUEST HOOK] Span created:', {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      functionName: context.functionName,
      requestId: context.awsRequestId,
    });
  },
  responseHook: (span, { err, res }) => {
    console.log('✅ [RESPONSE HOOK] Span ending:', {
      spanId: span.spanContext().spanId,
      hasError: !!err,
      statusCode: res?.statusCode,
    });
  },
});

// Create SDK with in-memory exporter
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'lambda-rie-test',
  }),
  instrumentations: [instrumentation],
  spanProcessor: new SimpleSpanProcessor(memoryExporter),
});

// Start SDK
sdk.start();
console.log('✅ [init-otel] OpenTelemetry SDK started');
console.log('✅ [init-otel] AWS Lambda instrumentation enabled');

// Store SDK globally for shutdown
global.__otelSdk = sdk;

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 [init-otel] Shutting down OpenTelemetry...');
  try {
    await sdk.shutdown();
    console.log('✅ [init-otel] Shutdown complete');
  } catch (error) {
    console.error('❌ [init-otel] Shutdown error:', error);
  }
});

console.log('✅ [init-otel] Ready - Lambda handler will be instrumented');
