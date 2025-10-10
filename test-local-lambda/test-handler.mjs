// Mock ESM Lambda handler for testing instrumentation
// This simulates your actual lambda.ts handler

import { diag } from '@opentelemetry/api';

console.log('[test-handler] Loading ESM handler module');

// Simulate your actual handler function
export const handler = async (event, context, callback) => {
  console.log('[test-handler] Handler function invoked');
  console.log('[test-handler] Event:', JSON.stringify(event, null, 2));
  console.log('[test-handler] Context:', JSON.stringify(context, null, 2));

  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));

  const result = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from test ESM handler!',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
    }),
  };

  console.log('[test-handler] Returning result:', result);

  // Simulate both callback and promise return patterns
  if (callback && typeof callback === 'function') {
    callback(null, result);
  }

  return result;
};

console.log('[test-handler] ESM handler module loaded successfully');
