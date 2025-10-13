/**
 * Pure ESM Lambda Handler - NO MODIFICATIONS!
 *
 * This is exactly how your handler would look without any OpenTelemetry code.
 * The shim wrapper handles all the patching automatically.
 */

console.log('[Pure ESM Handler] Loading module');

export async function handler(event, context) {
  console.log('[Pure ESM Handler] Function invoked');
  console.log('[Pure ESM Handler] Event:', JSON.stringify(event, null, 2));
  console.log('[Pure ESM Handler] Context:', {
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
      message: 'Hello from PURE ESM Lambda - Zero modifications!',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      coldStart: !global.warmStart,
      approach: 'CJS Shim Wrapper',
    }),
  };

  // Mark as warm start for next invocation
  global.warmStart = true;

  console.log('[Pure ESM Handler] Returning response:', response.statusCode);
  return response;
}

console.log('[Pure ESM Handler] Module loaded successfully');
