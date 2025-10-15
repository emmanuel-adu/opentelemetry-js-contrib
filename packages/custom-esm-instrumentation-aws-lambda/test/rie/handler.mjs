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
