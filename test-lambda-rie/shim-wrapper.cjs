/**
 * CJS Shim Wrapper for ESM Lambda Handlers (RIE Test)
 */

const path = require('path');

// Get the actual handler location from environment variable
const ACTUAL_HANDLER = process.env.ACTUAL_HANDLER || 'handler-pure-esm.handler';

console.log(
  `🔧 [CJS Shim] Initializing with ACTUAL_HANDLER: ${ACTUAL_HANDLER}`
);

// Parse handler definition
const [moduleName, functionName] = ACTUAL_HANDLER.split('.');

// Lazy-load and patch the handler
let patchedHandler = null;

async function getPatchedHandler() {
  if (patchedHandler) {
    return patchedHandler;
  }

  // Dynamically import the ESM handler
  const taskRoot = process.env.LAMBDA_TASK_ROOT || '/var/task';
  const modulePath = path.join(taskRoot, `${moduleName}.mjs`);

  console.log(`🔧 [CJS Shim] Loading ESM handler from: ${modulePath}`);

  const handlerModule = await import(modulePath);
  const originalHandler = handlerModule[functionName];

  if (typeof originalHandler !== 'function') {
    throw new Error(
      `Handler function '${functionName}' not found in ${modulePath}`
    );
  }

  console.log(`✅ [CJS Shim] ESM handler loaded successfully`);

  // Check if OpenTelemetry instrumentation is available
  if (global.__aws_lambda_esm_instrumentation) {
    console.log(
      '🔧 [CJS Shim] OpenTelemetry instrumentation detected, patching handler...'
    );
    try {
      patchedHandler = global.__aws_lambda_esm_instrumentation.patchESMHandler(
        originalHandler,
        functionName
      );
      console.log(
        `✅ [CJS Shim] Successfully patched handler: ${ACTUAL_HANDLER}`
      );
    } catch (error) {
      console.error('❌ [CJS Shim] Failed to patch handler:', error.message);
      patchedHandler = originalHandler;
    }
  } else {
    console.warn(
      '⚠️  [CJS Shim] OpenTelemetry instrumentation not found, using original handler'
    );
    patchedHandler = originalHandler;
  }

  return patchedHandler;
}

// Export the wrapper handler
exports.handler = async function (event, context, callback) {
  const handler = await getPatchedHandler();
  return handler(event, context, callback);
};
