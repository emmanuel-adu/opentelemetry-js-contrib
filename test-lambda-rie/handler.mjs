/**
 * Zero-Modification ESM Lambda Handler
 *
 * This handler requires ZERO changes - the instrumentation automatically
 * patches it without any modifications to the handler file.
 */

console.log('[handler] Loading ESM module');

export async function handler(event, context) {
  console.log('[handler] Function invoked');
  console.log('[handler] Event:', JSON.stringify(event, null, 2));
  console.log('[handler] Context:', {
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
      message:
        'Hello from ESM Lambda with automatic OpenTelemetry instrumentation!',
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
      coldStart: !global.warmStart,
    }),
  };

  // Mark as warm start for next invocation
  global.warmStart = true;

  console.log('[handler] Returning response:', response.statusCode);
  return response;
}

console.log('[handler] ESM module loaded successfully');

// That's it! No modifications needed.
// The instrumentation automatically patches this handler when it's loaded.
