# Local ESM Testing

Quick local validation for AWS Lambda ESM instrumentation changes.

## Quick Start

```bash
# Install dependencies
npm install

# Run ESM patching validation (RECOMMENDED)
npm run test:esm
```

## What This Tests

- ✅ ESM module detection (`Symbol.toStringTag === 'Module'`)
- ✅ Handler function wrapping
- ✅ Span creation with correct attributes
- ✅ Request/Response hooks
- ✅ Validates that patching will work in AWS Lambda

## Expected Output

```
=== Test Summary ===
✅ ESM Detection: PASS
✅ Handler Wrapping: PASS
✅ Handler Execution: PASS
✅ Span Creation: PASS
✅ Request Hook: PASS
✅ Response Hook: PASS

🎉 SUCCESS: ESM patching logic is working correctly!
```

## Making Changes

1. Edit instrumentation code in `../packages/instrumentation-aws-lambda/src/instrumentation.ts`
2. Rebuild: `cd ../packages/instrumentation-aws-lambda && npm run compile`
3. Test: `npm run test:esm`

Fast iteration without AWS deployments!

## Files

- `test-esm-patching.mjs` - Main validation test
- `test-handler.mjs` - Mock ESM Lambda handler
- `package.json` - Dependencies and scripts
