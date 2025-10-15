# 🚨 Banner Fix - ESM Syntax Error

## Problem

You're getting this error:

```
SyntaxError: 'import' and 'export' may only appear at the top level (4:2)
```

Or this error:

```
ReferenceError: __dirname is not defined in ES module scope
```

## Cause

The errors occur because:

1. **Export in conditional block**: The original banner had the `export` statement inside an `if` block, which violates ESM syntax rules
2. **Missing CommonJS globals**: Some packages, expect CommonJS globals like `__dirname` and `__filename` to be available in ESM context

```javascript
// ❌ WRONG - This causes the error
if (globalThis.__aws_lambda_esm_instrumentation) {
  const patchedHandler =
    globalThis.__aws_lambda_esm_instrumentation.patchESMHandler(handler);
  export { patchedHandler as handler }; // ❌ Export inside if block
}
```

## Solution

Use this corrected banner that moves the `export` to the top level:

```yaml
custom:
  esbuild:
    banner:
      js: |
        import { createRequire } from 'module';
        const require = createRequire(import.meta.url);
        import { fileURLToPath as ssb_fileURLToPath } from 'url';
        import { dirname as ssb_dirname } from 'path';

        // Define CommonJS globals for ESM compatibility
        const _filename = ssb_fileURLToPath(import.meta.url);
        const _dirname = ssb_dirname(_filename);

        // Make __dirname and __filename available globally for packages that expect them
        if (typeof globalThis !== 'undefined') {
          globalThis.__dirname = _dirname;
          globalThis.__filename = _filename;
        }

        // ESM Auto-Patch Banner - Provides helper function for manual patching
        // Since ESM exports are immutable, we provide a patcher function you can use
        if (globalThis.__aws_lambda_esm_instrumentation) {
          console.log('🔧 OpenTelemetry instrumentation detected, setting up ESM patching helper...');

          // Create a global patcher function that can be called in your handler file
          globalThis.__patchESMHandler = (handlerFunction, handlerName = 'handler') => {
            if (typeof handlerFunction === 'function') {
              try {
                const patchedHandler = globalThis.__aws_lambda_esm_instrumentation.patchESMHandler(handlerFunction, handlerName);
                console.log('✅ ESM handler patched with OpenTelemetry');
                return patchedHandler;
              } catch (error) {
                console.error('❌ Failed to patch ESM handler:', error.message);
                return handlerFunction; // Return original if patching fails
              }
            }
            console.warn('⚠️ Handler is not a function, skipping OpenTelemetry patching');
            return handlerFunction;
          };
        }
```

## Key Changes

1. **✅ Helper function approach**: Creates a global `__patchESMHandler` function instead of trying to automatically patch
2. **✅ ESM compatible**: Works with ESM's immutable exports by providing a patcher function
3. **✅ Handler validation**: Checks if the handler is actually a function before attempting to patch
4. **✅ Safe fallback**: Returns the original handler if patching fails
5. **✅ CommonJS compatibility**: Defines `__dirname` and `__filename` globally for packages that expect them

## Why This Works

- **ESM Compatibility**: Since ESM exports are immutable, we provide a helper function instead of trying to modify exports directly
- **Handler Validation**: Checks `typeof handlerFunction === 'function'` to ensure the handler is actually a function before patching
- **Safe Fallback**: Returns the original handler if patching fails, ensuring your Lambda continues to work
- **Global Access**: The patcher function is available globally, so you can use it in your handler file
- **No Breaking Changes**: If instrumentation isn't available, the helper function returns the original handler

## How to Use in Your Handler

Update your handler file to use the patcher function:

```javascript
// handler.mjs
async function originalHandler(event, context) {
  // Your business logic
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' }),
  };
}

// Export the handler (patched if instrumentation is available)
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

## Test It

```bash
# Test locally first
npm run build

# If no syntax errors, deploy
npm run deploy
```

## Still Having Issues?

If you're still getting syntax errors:

1. **Check your serverless.yml formatting** - Make sure the YAML indentation is correct
2. **Verify esbuild version** - Ensure you're using a recent version of `serverless-esbuild`
3. **Check for other banners** - Make sure you don't have conflicting banner configurations

## Complete Working Example

See `complete-serverless-solution.yml` for a complete working serverless.yml configuration with the corrected banner.
