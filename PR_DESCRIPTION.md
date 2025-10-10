# Add ESM (ECMAScript Modules) Support to AWS Lambda Instrumentation

## Description

This PR adds support for ESM Lambda handlers (`.mjs` files or `"type": "module"`) while maintaining full backward compatibility with CommonJS handlers.

## Problem

The current AWS Lambda instrumentation only supports CommonJS modules. ESM Lambda handlers were not being instrumented because:

1. The CommonJS `require()` hook doesn't intercept ESM `import` statements in the same way
2. ESM modules have a different structure with `Symbol.toStringTag === 'Module'`
3. ESM exports may be in `module.default` or directly on the module object

## Solution

Added minimal ESM detection and handling:

1. **ESM Detection**: Check for `Symbol.toStringTag === 'Module'` to identify ESM modules
2. **Export Extraction**: Handle both `module.default` (ESM) and direct exports (CommonJS)
3. **Double Span Prevention**: Track span lifecycle to prevent errors when both callback and promise execute

## Changes

### Core Changes

1. **`extractModuleExports()` function** - Detects and extracts exports from both ESM and CommonJS modules
2. **Updated patching logic** - Uses `extractModuleExports()` and updates ESM default export after wrapping
3. **Span lifecycle tracking** - Prevents double span ending when handler uses both callback and promise

### Files Modified

- `packages/instrumentation-aws-lambda/src/instrumentation.ts` (+31 lines)
- `packages/instrumentation-aws-lambda/src/internal-types.ts` (type definitions)

## Testing

- ✅ Compiles without errors
- ✅ Lints without new warnings
- ✅ Tested locally with ESM handler
- ✅ Backward compatible with CommonJS handlers
- ✅ Fixes double span ending issue

## Breaking Changes

None. This is a pure addition that maintains 100% backward compatibility.

## Checklist

- [x] Code compiles and passes linting
- [x] Changes are minimal and focused
- [x] Follows project coding standards
- [x] Backward compatible
- [ ] Tests added/updated (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] CHANGELOG updated

## Additional Notes

This implementation is intentionally minimal, adding only the essential logic needed to support ESM modules. It leverages the existing OpenTelemetry instrumentation infrastructure rather than introducing new patterns or APIs.

## Example

### ESM Handler (now supported)

```javascript
// handler.mjs
export async function handler(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from ESM!' }),
  };
}
```

### CommonJS Handler (still supported)

```javascript
// handler.js
exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from CommonJS!' }),
  };
};
```

Both handlers are now fully instrumented with OpenTelemetry traces.
