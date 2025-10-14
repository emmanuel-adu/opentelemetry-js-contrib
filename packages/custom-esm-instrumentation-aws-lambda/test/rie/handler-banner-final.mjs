/**
 * Test handler with banner-based ESM auto-patching
 *
 * This simulates exactly what your serverless build would produce
 * with the banner configuration.
 */

console.log('[handler] Loading ESM module');

// Define the original handler function
async function originalHandler(event, context) {
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
        'Hello from ESM Lambda with banner-based OpenTelemetry instrumentation!',
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

// 🎯 BANNER CODE - This gets prepended by esbuild in your serverless setup
// Auto-patch ESM handlers with OpenTelemetry
let finalHandler = originalHandler;

if (globalThis.__aws_lambda_esm_instrumentation) {
  console.log('🔧 Banner: Attempting to patch ESM handler...');
  try {
    const patchedHandler =
      globalThis.__aws_lambda_esm_instrumentation.patchESMHandler(
        originalHandler
      );
    finalHandler = patchedHandler;
    console.log(
      '✅ Banner: ESM handler successfully patched with OpenTelemetry'
    );
  } catch (error) {
    console.error('❌ Banner: Failed to patch ESM handler:', error.message);
    // Fall back to original handler
    finalHandler = originalHandler;
  }
}

// Export the final handler (patched or original)
export { finalHandler as handler };
