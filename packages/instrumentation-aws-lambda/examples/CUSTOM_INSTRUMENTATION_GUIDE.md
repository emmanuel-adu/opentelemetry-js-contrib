# Custom AWS Lambda Instrumentation Guide

This guide shows you how to use the custom AWS Lambda instrumentation that works seamlessly with `serverless-esbuild` and ESM modules, giving you automatic handler patching without any code changes.

## 🎯 **Why Use Custom Instrumentation?**

- ✅ **Zero handler changes** - Your existing code stays exactly the same
- ✅ **Works with `serverless-esbuild`** - No compilation conflicts
- ✅ **ESM compatible** - Designed for modern ES modules
- ✅ **Drop-in replacement** - Works exactly like official OpenTelemetry instrumentations
- ✅ **Automatic patching** - Handlers are instrumented automatically
- ✅ **Full OpenTelemetry integration** - All the features you expect

## 🚀 **Quick Start**

### **1. Copy the Custom Instrumentation File**

Copy `custom-aws-lambda-instrumentation.ts` to your project:

```bash
cp packages/instrumentation-aws-lambda/examples/custom-aws-lambda-instrumentation.ts ./src/
```

### **2. Add to Your OpenTelemetry Setup**

```typescript
// opentelemetry.setup.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { CustomAwsLambdaInstrumentation } from './custom-aws-lambda-instrumentation';

const PACKAGE_VERSION = '1.0.0'; // Your custom version

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'my-api-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  instrumentations: [
    // Your existing instrumentations
    // ... other instrumentations,

    // Add the custom AWS Lambda instrumentation
    new CustomAwsLambdaInstrumentation({
      version: PACKAGE_VERSION, // Use your custom version
      requestHook: (span, event, context) => {
        span.setAttributes({
          'http.method': event.httpMethod,
          'user.id': event.headers?.['x-user-id'] || 'anonymous',
        });
      },
    }),
  ],
});

sdk.start();
```

### **3. Keep Your Handler Unchanged**

```typescript
// lambda.ts - NO CHANGES NEEDED!
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

async function handler(event: APIGatewayProxyEvent, context: Context) {
  console.log('Processing request:', event.requestContext.requestId);

  // Your business logic here
  const result = await processBusinessLogic(event);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

// Export as usual - no changes needed!
export { handler };
```

### **4. Keep Your Existing Setup**

Your `serverless.yml` stays exactly the same:

```yaml
plugins:
  - serverless-esbuild

custom:
  esbuild:
    sourcemap: true
    bundle: true
    minify: false
    format: 'esm'
    platform: 'node'
    target: 'esnext'
    outputFileExtension: '.mjs'

functions:
  api:
    handler: lambda.handler # ✅ No changes needed
    layers:
      - ${self:custom.environment.lambda.layers} # ✅ Your OTel layer
    environment:
      AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-handler # ✅ Keep this
```

## 🎯 **How It Works**

### **Production-Ready ESM Handler Detection**

The custom instrumentation automatically detects and patches Lambda handlers by:

1. **Using `process.env._HANDLER`** - Gets the exact handler location from AWS Lambda environment
2. **Targeted patching** - Only patches the specific handler function, not random functions
3. **Immediate execution** - No setTimeout delays, patches handlers as soon as they're available
4. **Intercepting exports** - Monitors module.exports assignments (CommonJS) and global assignments (ESM)
5. **Function signature detection** - Identifies Lambda handler patterns for safety
6. **ESM compatibility** - Works with ESM modules without relying on CommonJS require() hooks

### **Why This Works with ESM**

Unlike the official `@opentelemetry/instrumentation-aws-lambda` which uses `InstrumentationNodeModuleDefinition` (CommonJS-only), this custom instrumentation uses runtime patching that works with both CommonJS and ESM modules.

### **Handler Detection Process**

1. **Reads `process.env._HANDLER`** - Gets the exact handler specification (e.g., `lambda.handler`)
2. **Parses handler name** - Extracts the function name from the handler specification
3. **Targets specific function** - Only patches the exact handler function, not random functions
4. **Validates signature** - Ensures the function has 2-3 parameters (event, context, callback)
5. **Safety checks** - Verifies it's in a Lambda environment before patching

### **Instrumentation Features**

- ✅ **Root span creation** - Creates the main Lambda span
- ✅ **Cold start detection** - Tracks cold vs warm starts
- ✅ **Request/response hooks** - Add custom attributes
- ✅ **Error handling** - Proper error recording and span status
- ✅ **Trace propagation** - Extracts trace context from headers
- ✅ **Semantic conventions** - All standard OpenTelemetry attributes

## 📝 **Configuration Options**

### **Basic Configuration**

```typescript
new CustomAwsLambdaInstrumentation({
  // Optional: Custom request hook
  requestHook: (span, event, context) => {
    span.setAttributes({
      'http.method': event.httpMethod,
      'user.id': event.headers?.['x-user-id'] || 'anonymous',
    });
  },

  // Optional: Custom response hook
  responseHook: (span, err, res) => {
    if (res) {
      span.setAttributes({
        'http.status_code': res.statusCode,
        'response.size': JSON.stringify(res).length,
      });
    }
  },
});
```

### **Advanced Configuration**

```typescript
new CustomAwsLambdaInstrumentation({
  // Custom trace context extraction
  eventContextExtractor: (event, context) => {
    // Extract trace context from custom headers
    const traceHeader = event.headers?.['x-custom-trace-id'];
    if (traceHeader) {
      // Custom trace context extraction logic
      return customTraceContext;
    }

    // Fall back to default HTTP header extraction
    const httpHeaders = event.headers || {};
    return propagation.extract(otelContext.active(), httpHeaders, headerGetter);
  },

  // Disable instrumentation if needed
  disableInstrumentation: false,
});
```

## 🎯 **Benefits Over Other Approaches**

| Approach                   | Pros                                                                                           | Cons                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Custom Instrumentation** | ✅ Zero handler changes<br>✅ Works with esbuild<br>✅ ESM compatible<br>✅ Automatic patching | None!                                          |
| **Manual Instrumentation** | ✅ Works with esbuild<br>✅ Full control                                                       | ❌ Requires handler changes                    |
| **CJS Shim**               | ✅ No handler changes                                                                          | ❌ esbuild conflicts<br>❌ Complex setup       |
| **Banner Approach**        | ✅ Automatic patching                                                                          | ❌ esbuild conflicts<br>❌ Complex banner code |
| **serverless-bundle**      | ✅ ESM compatible                                                                              | ❌ Performance cost<br>❌ Migration effort     |

## 🚀 **Migration from Existing Solutions**

### **From Manual Instrumentation**

```typescript
// Before (manual instrumentation)
import { instrumentLambda } from './manual-lambda-instrumentation';

export const handler = instrumentLambda(originalHandler);

// After (custom instrumentation)
// Just remove the wrapper - handlers are patched automatically!
export const handler = originalHandler;
```

### **From CJS Shim**

```typescript
// Before (with shim)
// Remove shim-wrapper.cjs
// Remove ACTUAL_HANDLER environment variable

// After (custom instrumentation)
// Just add to your NodeSDK - no other changes needed!
```

### **From Banner Approach**

```typescript
// Before (with banner)
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;

// After (custom instrumentation)
// Just remove the banner code - handlers are patched automatically!
export const handler = originalHandler;
```

## 🔧 **Integration with OpenTelemetry SDK**

### **Lambda Layer Setup**

```javascript
// /opt/opentelemetry.setup.js (in your layer)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { CustomAwsLambdaInstrumentation } from './custom-aws-lambda-instrumentation';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'my-api-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  instrumentations: [
    // Other instrumentations work normally
    // ... other instrumentations,

    // Add the custom AWS Lambda instrumentation
    new CustomAwsLambdaInstrumentation(),
  ],
});

sdk.start();
```

### **Environment Variables**

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector.com
OTEL_SERVICE_NAME=my-api-service
```

## 🎯 **Best Practices**

1. **Add to NodeSDK** - Use it like any other OpenTelemetry instrumentation
2. **Configure hooks** - Add custom attributes for business context
3. **Keep handlers clean** - No OpenTelemetry code in your business logic
4. **Test locally** - Use the same setup for local development
5. **Monitor performance** - The instrumentation has minimal overhead

## 🚀 **Why This Is the Perfect Solution**

This custom instrumentation gives you:

- **Zero code changes** - Your handlers stay exactly the same
- **Automatic patching** - No manual wrapping or configuration
- **ESM compatibility** - Works with modern ES modules
- **serverless-esbuild friendly** - No compilation conflicts
- **Full OpenTelemetry features** - All the tracing and metrics you need
- **Drop-in replacement** - Works exactly like official instrumentations

This is the **cleanest, most maintainable solution** for ESM Lambda instrumentation! 🎉
