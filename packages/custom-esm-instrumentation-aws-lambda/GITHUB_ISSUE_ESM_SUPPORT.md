# GitHub Issue: ESM Support for AWS Lambda Instrumentation

---

## Issue Title

**[Feature Request] ESM (.mjs) Handler Support for AWS Lambda Instrumentation**

---

## Issue Body

### What version of OpenTelemetry are you using?

- `@opentelemetry/instrumentation-aws-lambda`: `^0.46.0` (latest)
- `@opentelemetry/api`: `^1.9.0`
- `@opentelemetry/instrumentation`: `^0.55.0`

### What version of Node are you using?

- **Node.js**: `v20.x` (also tested with `v18.x`)
- **Runtime**: AWS Lambda Node.js 20.x runtime
- **Module System**: ESM (`.mjs` files, `"type": "module"` in package.json)

### What did you do?

I attempted to use `@opentelemetry/instrumentation-aws-lambda` with an ESM Lambda handler:

**1. Created an ESM handler:**

```javascript
// handler.mjs
export const handler = async (event, context) => {
  console.log('Processing event:', event);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' }),
  };
};
```

**2. Configured OpenTelemetry:**

```javascript
// opentelemetry.setup.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';

const sdk = new NodeSDK({
  instrumentations: [
    new AwsLambdaInstrumentation(),
  ],
});

sdk.start();
```

**3. Deployed to AWS Lambda:**

```yaml
# serverless.yml
functions:
  myFunction:
    handler: handler.handler
    runtime: nodejs20.x
```

**4. Tested with AWS Lambda Runtime Interface Emulator (RIE)** to observe the instrumentation behavior locally before deploying.

### What did you expect to see?

Expected the handler to be automatically instrumented with OpenTelemetry traces, similar to how CommonJS (`.js`) handlers are instrumented:

- ✅ Automatic span creation for Lambda invocation
- ✅ AWS SDK calls traced
- ✅ HTTP requests instrumented
- ✅ Context propagation working
- ✅ No code changes required in the handler

### What did you see instead?

**The handler executed successfully but WITHOUT any OpenTelemetry instrumentation.**

**Investigation Results:**

Using extensive logging and RIE testing, I discovered:

1. **Detection works ✅** - The instrumentation correctly detects `.mjs` files:

   ```typescript
   // Source: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-aws-lambda/src/instrumentation.ts#L103-L129

   if (!filename.endsWith('.js')) {
     try {
       fs.statSync(`${filename}.mjs`);
       filename += '.mjs'; // ✅ ESM file detected!
     }
   }
   ```

2. **Patching silently fails ❌** - The patch callback never executes:

   ```typescript
   // Source: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-aws-lambda/src/instrumentation.ts#L146-L176

   return [
     new InstrumentationNodeModuleDefinition(
       filename, // "handler.mjs"
       ['*'],
       undefined,
       undefined,
       [
         new InstrumentationNodeModuleFile(
           module,
           ['*'],
           (moduleExports: LambdaModule) => {
             // ❌ This callback NEVER fires for ESM handlers!
             // InstrumentationNodeModuleDefinition only hooks require()
             // Lambda uses import() for .mjs files

             this._wrap(moduleExports, functionName, this._getHandler(...));
             return moduleExports;
           }
         ),
       ]
     ),
   ];
   ```

**Root Cause:**

`InstrumentationNodeModuleDefinition` is designed to hook into CommonJS `require()` calls, but AWS Lambda runtime loads ESM handlers using dynamic `import()` ([see UserFunction.js](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/main/src/UserFunction.js#L288)):

```javascript
// What Lambda does for .mjs files:
const handlerModule = await import('/var/task/handler.mjs');
const handler = handlerModule.handler;

// ❌ This bypasses the InstrumentationNodeModuleDefinition hook
// ❌ The patch callback never executes
// ❌ Handler remains uninstrumented
```

**Test Logs (from RIE):**

```
✅ Instrumentation initialized
✅ Handler file detected: handler.mjs
✅ InstrumentationNodeModuleDefinition registered
[handler.mjs] Function invoked ← Handler executes
❌ Patch callback never executed
❌ No traces generated
```

### Additional context

#### Why This Matters

1. **ESM is the JavaScript future** - Node.js ecosystem is moving toward ESM as the standard
2. **AWS Lambda supports ESM** - Official runtime support for `.mjs` and `"type": "module"`
3. **Observability gap** - Teams adopting ESM lose automatic instrumentation
4. **Silent failure** - No errors, just missing traces (hard to debug)

#### Potential Solutions

I've tested several approaches and am willing to contribute an implementation with guidance:

**Option 1: `import-in-the-middle` Integration (Similar to AWS ADOT)**

Use the `import-in-the-middle` library to intercept ESM imports:

```javascript
import { addHook } from 'import-in-the-middle';

addHook((exports, name, baseDir) => {
  // Check if this module has a Lambda handler
  if (exports && typeof exports.handler === 'function') {
    exports.handler = wrapWithInstrumentation(exports.handler);
  }
  return exports;
});
```

**Pros:**

- Can intercept ESM imports before Lambda runtime executes them
- Works with `--experimental-loader` or `--import` flags
- Similar to how ADOT approaches this problem

**Cons:**

- Requires Node.js experimental loader flags
- Adds `import-in-the-middle` as a dependency
- More complex implementation

**Option 2: Wrapper-Based API**

Provide a simple wrapper function for ESM handlers:

```javascript
import { instrumentHandler } from '@opentelemetry/instrumentation-aws-lambda';

async function myHandler(event, context) {
  // Business logic
  return { statusCode: 200 };
}

export const handler = instrumentHandler(myHandler);
```

**Pros:**

- Works within ESM constraints
- Simple and predictable
- No experimental flags needed

**Cons:**

- Requires minimal code change in every handler
- Not truly "automatic" instrumentation

#### Questions for Maintainers

I'm ready to contribute, but need guidance on:

1. **Which approach aligns with OpenTelemetry's architecture and philosophy?**
2. **Are experimental Node.js features (`--experimental-loader`) acceptable?**
3. **Should we add `import-in-the-middle` as a peer/optional dependency?**
4. **Are there existing patterns in other OTEL instrumentations for ESM support?**

#### My Testing & Research

- ✅ Tested with AWS Lambda Runtime Interface Emulator (RIE)
- ✅ Created working prototypes of both approaches
- ✅ Documented all attempts and findings
- ✅ Analyzed Lambda runtime source code to understand module loading
- ✅ Confirmed the issue exists in both local (RIE) and AWS environments

I have detailed documentation and working code that I'm happy to share or turn into a PR with proper guidance.

#### Related Resources

- AWS Lambda Runtime Interface Client: https://github.com/aws/aws-lambda-nodejs-runtime-interface-client
- Handler Loading Source: https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/main/src/UserFunction.js#L288
- import-in-the-middle: https://github.com/DataDog/import-in-the-middle

---

### Related Issues/PRs

<!-- If you know of related issues or PRs, please link them here -->

---

<sub>**Tip**: [React](https://github.blog/news-insights/product-news/add-reactions-to-pull-requests-issues-and-comments/) with 👍 to help prioritize this issue. Please use comments to provide useful context, avoiding `+1` or `me too`, to help us triage it. Learn more [here](https://opentelemetry.io/community/end-user/issue-participation/).</sub>
