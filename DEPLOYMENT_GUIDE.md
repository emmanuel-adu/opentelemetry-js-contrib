# Deployment Guide: Testing ESM Support in AWS Lambda

## Quick Start

### 1. Build the Package

```bash
cd /Users/emmanueladu/Development/open-source-otel/opentelemetry-js-contrib/packages/instrumentation-aws-lambda
npm run compile
npm pack
```

This creates a tarball like `opentelemetry-instrumentation-aws-lambda-0.58.0.tgz`

### 2. Update Your Lambda Layer

In your Lambda layer's `package.json`:

```json
{
  "dependencies": {
    "@opentelemetry/instrumentation-aws-lambda": "file:./opentelemetry-instrumentation-aws-lambda-0.58.0.tgz",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.205.0",
    "@opentelemetry/auto-instrumentations-node": "^0.52.1",
    "@opentelemetry/exporter-trace-otlp-http": "^0.205.0"
  }
}
```

### 3. Copy the Tarball

```bash
# Copy the tarball to your Lambda layer directory
cp opentelemetry-instrumentation-aws-lambda-0.58.0.tgz /path/to/your/lambda-layer/
```

### 4. Install Dependencies

```bash
cd /path/to/your/lambda-layer/
npm install
```

### 5. Deploy Your Layer

```bash
# Zip the layer
zip -r layer.zip nodejs/

# Upload to AWS Lambda
aws lambda publish-layer-version \
  --layer-name my-otel-layer \
  --zip-file fileb://layer.zip \
  --compatible-runtimes nodejs20.x nodejs18.x
```

### 6. Test Your ESM Handler

Your ESM handler should now be instrumented:

```javascript
// handler.mjs
export async function handler(event, context) {
  console.log('Handler invoked');

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from instrumented ESM handler!',
      requestId: context.requestId,
    }),
  };
}
```

## Verification

### Check CloudWatch Logs

Look for:

1. `Instrumenting lambda handler` - confirms instrumentation is active
2. Trace IDs in logs - confirms spans are being created
3. No errors about "Cannot execute the operation on ended Span"

### Check Your Observability Backend

Verify that:

1. Traces are appearing in your backend (Jaeger, Zipkin, etc.)
2. Spans have correct attributes (`faas.execution`, `faas.id`, etc.)
3. Parent-child relationships are correct

### Expected Log Output

```
Instrumenting lambda handler {
  taskRoot: '/var/task',
  handlerDef: 'handler.handler',
  handler: 'handler.handler',
  moduleRoot: '',
  module: 'handler',
  filename: '/var/task/handler.mjs',
  functionName: 'handler'
}
```

## Troubleshooting

### Issue: Handler not instrumented

**Check:**

- Is the layer attached to your Lambda function?
- Is the `_HANDLER` environment variable correct?
- Are there any errors in CloudWatch logs?

**Solution:**

```bash
# Verify layer is attached
aws lambda get-function-configuration --function-name my-function

# Check environment variables
aws lambda get-function-configuration --function-name my-function | jq '.Environment'
```

### Issue: "Module not found" errors

**Check:**

- Did you run `npm install` after updating package.json?
- Is the tarball path correct in package.json?

**Solution:**

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Issue: Traces not appearing

**Check:**

- Is your OTLP exporter configured correctly?
- Is the exporter endpoint reachable from Lambda?
- Are there any network/security group issues?

**Solution:**

```javascript
// Add debug logging to your instrumentation
process.env.OTEL_LOG_LEVEL = 'debug';
```

## Alternative: Direct Installation (for testing)

If you want to test without creating a layer:

```bash
# In your Lambda function directory
npm install /path/to/opentelemetry-instrumentation-aws-lambda-0.58.0.tgz
```

Then deploy your function with the updated `node_modules`.

## Rollback

If you need to rollback to the npm version:

```json
{
  "dependencies": {
    "@opentelemetry/instrumentation-aws-lambda": "^0.57.2"
  }
}
```

```bash
rm opentelemetry-instrumentation-aws-lambda-0.58.0.tgz
npm install
```

## Next Steps

Once you've verified the changes work in AWS Lambda:

1. Document any issues or edge cases you encounter
2. Test with different ESM patterns (default exports, named exports, mixed)
3. Test with CommonJS handlers to ensure no regression
4. Provide feedback on the PR

## Support

If you encounter issues:

1. Check CloudWatch logs for detailed error messages
2. Enable debug logging: `process.env.OTEL_LOG_LEVEL = 'debug'`
3. Compare with the local test setup in `test-local-lambda/`
4. Open an issue with:
   - Lambda runtime version
   - Handler code
   - CloudWatch logs
   - Expected vs actual behavior
