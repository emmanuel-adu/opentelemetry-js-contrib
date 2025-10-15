/**
 * ESM Loader for Custom AWS Lambda Instrumentation
 * This loader hooks into ESM module loading to instrument handlers
 */

import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';

// Store reference to the instrumentation
let instrumentation = null;

// Try to get the instrumentation from global scope
try {
  instrumentation = globalThis.__aws_lambda_esm_instrumentation;
} catch (error) {
  console.log('[ESM Loader] No instrumentation found in global scope');
}

/**
 * ESM Loader hook function
 * This is called by Node.js for each ESM module being loaded
 */
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);

  // Log the module being resolved
  if (instrumentation) {
    instrumentation._diag.debug('ESM module being resolved', {
      specifier,
      resolvedUrl: resolved.url,
    });
  }

  return resolved;
}

/**
 * ESM Loader transform hook
 * This allows us to modify the source code of modules before they're executed
 */
export async function load(url, context, nextLoad) {
  // Only process our handler module
  if (url.includes('lambda') || url.endsWith('.mjs')) {
    if (instrumentation) {
      instrumentation._diag.debug('Processing handler module in ESM loader', {
        url,
      });
    }

    // Get the source code
    const result = await nextLoad(url, context);

    // Check if this module exports a handler function
    const functionName = process.env._HANDLER?.split('.')[1] || 'handler';

    if (
      result.format === 'module' &&
      result.source.includes(`export.*${functionName}`)
    ) {
      if (instrumentation) {
        instrumentation._diag.debug('ESM loader found handler', {
          url,
          functionName,
        });
      }

      // We could modify the source here, but for now, we'll patch after loading
      // This is where we'd inject our instrumentation code
    }

    return result;
  }

  // For all other modules, use the default loader
  return nextLoad(url, context);
}

/**
 * Post-load hook to patch the handler after module is loaded
 */
export async function transformSource(source, context, nextTransformSource) {
  // Only process our handler module
  if (context.url.includes('lambda') || context.url.endsWith('.mjs')) {
    if (instrumentation) {
      instrumentation._diag.debug('Transforming handler module source', {
        url: context.url,
      });
    }

    // Get the transformed source
    const result = await nextTransformSource(source, context);

    // Check if this module exports a handler function
    const functionName = process.env._HANDLER?.split('.')[1] || 'handler';

    if (result.source.includes(`export.*${functionName}`)) {
      if (instrumentation) {
        instrumentation._diag.debug(
          'Found handler export in transformed source',
          {
            url: context.url,
            functionName,
          }
        );
      }

      // Here we could inject our instrumentation code into the source
      // For now, we'll rely on the post-load patching
    }

    return result;
  }

  // For all other modules, use the default transform
  return nextTransformSource(source, context);
}
