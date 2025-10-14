# Lambda Runtime Interface Emulator (RIE) Tests

Local tests for the custom ESM instrumentation using AWS Lambda Runtime Interface Emulator.

## Files

| File                              | Purpose                              |
| --------------------------------- | ------------------------------------ |
| `package.json`                    | Test dependencies and scripts        |
| `build-custom-instrumentation.sh` | Compiles instrumentation to CommonJS |
| `init-otel-custom.cjs`            | OpenTelemetry initialization         |
| `otel-handler-custom`             | Docker entrypoint wrapper            |
| `handler.mjs`                     | Test Lambda handler (ESM)            |
| `event.json`                      | Sample Lambda event payload          |
| `docker-compose.custom.yml`       | Docker Compose configuration         |
| `Dockerfile.custom`               | RIE container definition             |
| `.gitignore`                      | Ignore build artifacts               |

## Quick Start

```bash
# Install dependencies
npm install

# Run test
npm run test:custom
```

**Prerequisites:** Docker, Node.js >= 18, `jq`

## Available Scripts

| Script                      | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| `npm run build:custom`      | Build custom instrumentation to CommonJS and Docker image |
| `npm run test:custom`       | Run complete test (build → start → invoke → stop)         |
| `npm run test:custom:quick` | Quick invoke without rebuild                              |
| `npm run start:custom`      | Start RIE container                                       |
| `npm run stop:custom`       | Stop RIE container                                        |
| `npm run logs:custom`       | Tail RIE logs                                             |
| `npm run invoke:custom`     | Invoke Lambda and check for traces                        |
| `npm run check:custom`      | Check logs for trace output                               |
| `npm run clean:custom`      | Clean up containers and volumes                           |

## What Gets Tested

- ✅ OpenTelemetry SDK initialization
- ✅ ESM handler execution
- ✅ Request/response hooks
- ⚠️ Runtime patching (may not work in RIE)

**Note:** RIE has module loading differences from real Lambda. For full validation, test in actual AWS Lambda.

## Expected Output

```bash
$ npm run invoke:custom

{
  "statusCode": 200,
  "body": "..."
}

✅ [init-otel-custom] OpenTelemetry SDK started
✅ [CUSTOM REQUEST HOOK] Span created
✅ [CUSTOM RESPONSE HOOK] Span ending
```

## Troubleshooting

**No trace logs?** This is expected in RIE due to module loading differences. Test in real AWS Lambda.

**Docker build fails?** Run `npm run clean:custom && docker system prune -f`

## Real Lambda Testing

For production validation:

```bash
# Package
cd packages/custom-esm-instrumentation-aws-lambda
npm pack

# Install in your layer
cp opentelemetry-instrumentation-aws-lambda-esm-1.0.0.tgz /path/to/your/layer/
cd /path/to/your/layer/nodejs
npm install ../../opentelemetry-instrumentation-aws-lambda-esm-1.0.0.tgz

# Deploy and test
serverless deploy
serverless invoke -f yourFunction -l
```

## Cleanup

After running tests, you may want to clean up artifacts:

```bash
# Stop containers and remove volumes
npm run clean:custom

# Also remove Docker images (full cleanup)
npm run clean:all

# Manual cleanup if needed
docker compose -f docker-compose.custom.yml down -v
docker image rm rie_lambda-rie-custom
rm -f custom-instrumentation-compiled.cjs
```

**Note:** Build artifacts (`custom-instrumentation-compiled.cjs`, `node_modules/`, `package-lock.json`) are gitignored and recreated on each test run.
