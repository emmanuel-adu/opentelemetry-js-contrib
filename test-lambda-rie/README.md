# Lambda Runtime Interface Emulator (RIE) Test

Simple validation that ESM handlers work in AWS Lambda's official runtime environment.

## Purpose

This test validates that `.mjs` (ESM) handlers execute correctly in AWS Lambda's Node.js 20 runtime using the official Lambda Runtime Interface Emulator.

**For full OpenTelemetry instrumentation testing, use:** `../test-local-lambda/`

## Prerequisites

- Docker installed and running

## Quick Start

```bash
# Build and run
./build.sh
./run.sh

# Test the function
./test.sh

# Stop when done
docker stop lambda-rie-test
```

## What This Tests

✅ ESM handlers (`.mjs`) work in Lambda's runtime
✅ Lambda RIE correctly loads ESM modules
✅ Handler receives correct event and context
✅ Handler returns correct response

## Expected Output

```
📥 Response received:
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"message\":\"Hello from ESM Lambda with OpenTelemetry!\"}"
}

[handler] Function invoked
[handler] Returning response: 200
```

## Why Not Test Full Instrumentation Here?

Setting up OpenTelemetry in Docker with Lambda RIE is complex due to:

- Module resolution in containerized environment
- Peer dependency management
- ESM import timing issues

**Instead, use `test-local-lambda/test-esm-patching.mjs`** which:

- ✅ Tests full instrumentation (spans, hooks, attributes)
- ✅ Validates ESM patching logic
- ✅ Runs in ~1 second
- ✅ Easier to debug
- ✅ 95% production similarity

This RIE test is useful for:

- Validating ESM handlers work in Lambda's runtime
- Testing Lambda-specific behavior
- Confirming `.mjs` files load correctly

## Cleanup

```bash
docker stop lambda-rie-test
docker rm lambda-rie-test
docker rmi lambda-rie-test:latest
```

## Recommendation

**For ESM instrumentation testing:** Use `../test-local-lambda/npm run test:esm`
**For Lambda runtime validation:** Use this RIE test
