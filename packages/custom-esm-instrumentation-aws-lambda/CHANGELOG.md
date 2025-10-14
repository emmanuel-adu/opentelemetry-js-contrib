# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2024-10-14

### Initial Release

**Features:**

- ✅ Native ESM support for AWS Lambda
- ✅ serverless-esbuild compatibility
- ✅ Zero handler modifications required
- ✅ Runtime patching via `Object.defineProperty`
- ✅ Full OpenTelemetry API support (spans, context, propagation)
- ✅ Cold start detection
- ✅ Streaming handler support
- ✅ TypeScript definitions included

**Configuration:**

- `requestHook` - Add custom span attributes from event/context
- `responseHook` - Add custom span attributes from response/errors
- `eventContextExtractor` - Extract trace context from custom formats

**Performance Impact:**

- Cold Start: +100-200ms
- Warm Invocation: +2ms
- Memory: +22MB

**Limitations:**

- ⚠️ Experimental status - test thoroughly before production
- ⚠️ Runtime patching may not work in Lambda RIE
- ⚠️ Higher cold start overhead than official instrumentation

**Requirements:**

- Node.js >= 18
- `@opentelemetry/api` ^1.9.0
- `@opentelemetry/instrumentation` ^0.205.0

---

## Migration Guide

### From Official Instrumentation

If you're currently using `@opentelemetry/instrumentation-aws-lambda`:

**Before:**

```javascript
const {
  AwsLambdaInstrumentation,
} = require('@opentelemetry/instrumentation-aws-lambda');
```

**After:**

```javascript
const {
  CustomAwsLambdaInstrumentation,
} = require('@opentelemetry/instrumentation-aws-lambda-esm');
```

**Configuration stays the same:**

```javascript
new CustomAwsLambdaInstrumentation({
  requestHook: (span, { event, context }) => {
    /* same API */
  },
  responseHook: (span, { err, res }) => {
    /* same API */
  },
});
```

**serverless.yml changes:**

```yaml
# Add these to custom.esbuild:
custom:
  esbuild:
    format: 'esm' # NEW: Must be ESM
    external:
      - '@opentelemetry/*' # NEW: Don't bundle OTel
```

---

## Contributing

See [../../CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## License

Apache 2.0 - See [LICENSE](./LICENSE) for more information.
