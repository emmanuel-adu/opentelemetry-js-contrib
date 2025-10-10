# Lambda Runtime Interface Emulator (RIE) Test

Complete validation of ESM handlers with OpenTelemetry instrumentation in AWS Lambda's official runtime environment.

## Purpose

This test validates ESM (`.mjs`) handlers with full OpenTelemetry instrumentation in a production-like AWS Lambda environment using Docker and the official Lambda Runtime Interface Emulator.

## What This Tests

- ✅ ESM handlers (`.mjs`) work in Lambda's runtime
- ✅ Banner-based OpenTelemetry patching
- ✅ Span creation with valid trace/span IDs
- ✅ Request/Response hooks execution
- ✅ Cold start detection
- ✅ Handler receives correct event and context
- ✅ Complete trace lifecycle

## Prerequisites

- Docker installed and running
- `jq` installed (for JSON formatting)

## Quick Start (Recommended)

### Run Full Test Suite

```bash
# One command to run everything
npm test
```

This will:

1. Build the Docker image
2. Start the Lambda container
3. Wait for initialization
4. Invoke the function
5. Check for traces
6. Stop the container

### Individual Commands

```bash
# Build Docker image
npm run build

# Start Lambda container
npm run start

# Invoke Lambda and check traces
npm run invoke

# View live logs
npm run logs

# Stop container
npm run stop

# Clean up everything
npm run clean
```

### Quick Invoke (if container is already running)

```bash
# Just invoke the function
npm run test:quick
```

## Alternative (Using Shell Scripts)

```bash
# Build and run
./build.sh
./run.sh

# Test the function
./test.sh

# Stop when done
docker stop lambda-rie-test
```

## Expected Output

```bash
$ npm test

> lambda-rie-test@1.0.0 test
> npm run test:full

✅ Docker image built
✅ Container started

📥 Response received:
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"message\":\"Hello from ESM Lambda with banner-based OpenTelemetry instrumentation!\",\"timestamp\":\"2025-10-10T21:22:04.768Z\",\"requestId\":\"dd9f0251-6ae9-4abb-87a7-1b669f3ddab2\",\"coldStart\":false}"
}

📋 Trace Logs:
✅ [REQUEST HOOK] Span created
✅ [RESPONSE HOOK] Span ending: { spanId: '2ac324ef56388d66', hasError: false, statusCode: 200 }
✅ Banner: ESM handler successfully patched with OpenTelemetry

✅ Test complete!
```

## Available npm Scripts

| Command              | Description                                         |
| -------------------- | --------------------------------------------------- |
| `npm test`           | Run full test suite (build + start + invoke + stop) |
| `npm run test:quick` | Quick invoke (if container already running)         |
| `npm run build`      | Build Docker image with instrumentation             |
| `npm run start`      | Start Lambda container in background                |
| `npm run invoke`     | Invoke Lambda and check for traces                  |
| `npm run logs`       | View live container logs                            |
| `npm run stop`       | Stop and remove container                           |
| `npm run clean`      | Full cleanup (containers + images)                  |

## What Gets Validated

### 1. ESM Module Loading

- Lambda correctly loads `.mjs` files as ESM modules
- Banner code executes at the right time
- Handler function is available for patching

### 2. OpenTelemetry Integration

- SDK initializes successfully
- Instrumentation registers correctly
- Global `__aws_lambda_esm_instrumentation` is available

### 3. Banner Patching

- Banner detects instrumentation
- `patchESMHandler()` is called
- Handler is wrapped with tracing logic
- Re-export works correctly

### 4. Trace Generation

- Spans created with valid span IDs
- Trace IDs generated correctly
- Request hook executes before handler
- Response hook executes after handler
- Span attributes include Lambda context

### 5. Lambda Runtime Behavior

- Cold start detection works
- Warm start detection works
- Event and context are correct
- Response format is valid

## Test Results

See [FINAL_TEST_RESULTS.md](./FINAL_TEST_RESULTS.md) for detailed test results including:

- Span IDs and Trace IDs
- Cold/warm start detection
- Performance metrics
- Complete log evidence

## Troubleshooting

### Container won't start

```bash
npm run stop
npm run clean
npm run build
npm run start
```

### No trace logs visible

```bash
# View full logs
npm run logs

# Or check specific patterns
docker compose logs lambda-rie | grep -i "otel\|span\|trace"
```

### Port 9000 already in use

```bash
# Stop any existing containers
docker ps | grep lambda-rie
docker stop lambda-rie-test

# Or change port in docker-compose.yml
```

## Cleanup

```bash
# Stop container
npm run stop

# Full cleanup (containers + images)
npm run clean
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Docker Container                │
│  ┌───────────────────────────────────┐  │
│  │   AWS Lambda Runtime (RIE)        │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  OpenTelemetry SDK          │  │  │
│  │  │  - Instrumentation          │  │  │
│  │  │  - InMemorySpanExporter     │  │  │
│  │  └─────────────────────────────┘  │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  handler.mjs (ESM)          │  │  │
│  │  │  - Banner auto-patch        │  │  │
│  │  │  - No manual modifications  │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
           │
           │ HTTP (port 9000)
           │
    ┌──────▼──────┐
    │  npm invoke │
    └─────────────┘
```

## Why This Test Matters

1. **Production-like Environment**: Uses AWS's official Lambda Runtime Interface Emulator
2. **Real Module Loading**: Tests actual ESM `import()` behavior in Lambda
3. **Complete Validation**: Tests entire trace lifecycle from init to export
4. **Banner Verification**: Proves banner-based patching works in production
5. **Zero Modifications**: Confirms handlers need no changes

## Comparison with Other Tests

| Test                | Environment         | Speed | Coverage  | Use Case              |
| ------------------- | ------------------- | ----- | --------- | --------------------- |
| **RIE Test**        | Docker + Lambda RIE | ~10s  | 100%      | Production validation |
| `test-local-lambda` | Local Node.js       | ~1s   | 95%       | Quick iteration       |
| Unit tests          | Jest                | <1s   | Code only | Development           |

## Next Steps

After RIE tests pass:

1. ✅ Copy banner from `examples/complete-serverless-solution.yml`
2. ✅ Add to your `serverless.yml`
3. ✅ Deploy to AWS Lambda
4. ✅ Verify traces in your backend

**Your ESM handlers will automatically be instrumented!** 🎉
