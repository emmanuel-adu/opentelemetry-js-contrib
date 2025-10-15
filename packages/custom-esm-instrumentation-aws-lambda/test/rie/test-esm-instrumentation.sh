#!/bin/bash

# Test script for ESM instrumentation using RIE
# This tests the new ESM loader approach

set -e

echo "🧪 Testing ESM instrumentation with RIE..."

# Build the custom instrumentation
echo "📦 Building custom instrumentation..."
cd /Users/emmanueladu/Development/open-source-otel/opentelemetry-js-contrib/packages/custom-esm-instrumentation-aws-lambda
npm run compile
npm pack

# Extract the tarball to test directory
cd test/rie
tar -xzf ../../opentelemetry-instrumentation-aws-lambda-esm-1.0.0.tgz

# Copy ESM files to test directory
echo "📋 Copying ESM files..."
cp ../../esm-loader.mjs ./custom-esm-loader.mjs
cp ../../setup-esm-instrumentation.sh ./setup-esm-instrumentation.sh
cp ../../custom-instrumentation-setup.js ./custom-instrumentation-setup.js
cp ../../otel-handler-custom-esm ./otel-handler-custom-esm

# Create a test-specific ESM wrapper that uses the compiled CJS file
echo "📝 Creating test-specific ESM wrapper..."
cat > custom-esm-wrapper.mjs << 'WRAPPER_EOF'
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
WRAPPER_EOF

# Make scripts executable
chmod +x ./setup-esm-instrumentation.sh
chmod +x ./otel-handler-custom-esm

# Create a simple ESM handler for testing
echo "📝 Creating test ESM handler..."
cat > handler.mjs << 'EOF'
/**
 * Test ESM handler for RIE testing
 */

console.log('[handler.mjs] Loading ESM module');

// Define the original handler function
async function handler(event, context) {
  console.log('[handler.mjs] Function invoked');
  console.log('[handler.mjs] Event:', JSON.stringify(event, null, 2));
  console.log('[handler.mjs] Context:', {
    functionName: context.functionName,
    functionVersion: context.functionVersion,
    requestId: context.awsRequestId,
    memoryLimitInMB: context.memoryLimitInMB,
  });

  // Simulate some async work
  await new Promise(resolve => setTimeout(resolve, 100));

  const response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Hello from ESM Lambda handler!',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      coldStart: !global.warmStart,
      instrumentation: 'ESM Loader Test',
    }),
  };

  // Mark as warm start for next invocation
  global.warmStart = true;

  console.log('[handler.mjs] Returning response:', response.statusCode);
  return response;
}

console.log('[handler.mjs] ESM module loaded successfully');

// Export the handler
export { handler };
EOF

# Create package.json with ESM type
echo "📦 Creating package.json for ESM..."
cat > package.json << 'EOF'
{
  "name": "lambda-rie-esm-test",
  "version": "1.0.0",
  "type": "module",
  "description": "RIE test for ESM instrumentation",
  "scripts": {
    "build:esm": "./build-esm-instrumentation.sh",
    "test:esm": "npm run build:esm && npm run start:esm && sleep 3 && npm run invoke:esm && npm run stop:esm",
    "start:esm": "docker compose -f docker-compose.esm.yml up -d",
    "stop:esm": "docker compose -f docker-compose.esm.yml down",
    "invoke:esm": "curl -s -X POST http://localhost:9002/2015-03-31/functions/function/invocations -d @event.json | jq '.'",
    "logs:esm": "docker compose -f docker-compose.esm.yml logs -f lambda-rie-esm",
    "check:esm": "docker compose -f docker-compose.esm.yml logs lambda-rie-esm | grep -E '(CUSTOM REQUEST HOOK|CUSTOM RESPONSE HOOK|Handler patched|ESM|instrumentation)' | tail -15 || echo '⚠️  No trace logs found yet. Try: npm run logs:esm'",
    "clean:esm": "rm -f custom-instrumentation-compiled.cjs custom-instrumentation.ts types.ts types.js custom-esm-loader.mjs custom-esm-wrapper.mjs setup-esm-instrumentation.sh custom-instrumentation-setup.js otel-handler-custom-esm handler.mjs package.json"
  }
}
EOF

# Create event.json for testing
echo "📄 Creating test event..."
cat > event.json << 'EOF'
{
  "httpMethod": "GET",
  "path": "/test",
  "headers": {
    "Content-Type": "application/json"
  },
  "queryStringParameters": null,
  "body": null,
  "isBase64Encoded": false
}
EOF

echo "✅ ESM RIE test setup complete!"
echo ""
echo "🚀 To run the test:"
echo "  npm run test:esm"
echo ""
echo "📊 To check logs:"
echo "  npm run check:esm"
echo "  npm run logs:esm"
echo ""
echo "🧹 To clean up:"
echo "  npm run clean:esm"
