# ESM Lambda Instrumentation with OpenTelemetry

> A technical deep-dive into instrumenting ECMAScript Module (ESM) Lambda functions with OpenTelemetry

---

## 🎉 TL;DR - Solution Found!

**The official [`opentelemetry-lambda`](https://github.com/open-telemetry/opentelemetry-lambda) Lambda Layer already supports ESM with ZERO code changes!**

```bash
# Just add the layer and set the wrapper - that's it!
aws lambda update-function-configuration \
  --layers arn:aws:lambda:us-east-1:184161586896:layer:opentelemetry-nodejs:latest \
  --environment Variables="{AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler}"
```

Your ESM handlers work automatically - no modifications needed. Read on to understand why other approaches fail and how this solution works.

---

## 📚 Table of Contents

1. [Background: The OpenTelemetry Ecosystem](#1-background-the-opentelemetry-ecosystem)
2. [The Problem: Why ESM Breaks Instrumentation](#2-the-problem-esm-vs-commonjs)
3. [Where the Official Solution Fails](#3-where-it-fails)
4. [Solutions: What We Tried](#4-solutions)
5. [Testing with Lambda RIE](#5-testing-with-lambda-rie)
6. [Recommendations](#6-recommendations)

## 1. Background: The OpenTelemetry Ecosystem

### 🏗️ The OpenTelemetry Repository Structure

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│         OpenTelemetry for JavaScript Ecosystem                  │
│                                                                 │
│  ┌───────────────────┐    ┌──────────────────────────────┐    │
│  │ opentelemetry-js  │    │ opentelemetry-js-contrib     │    │
│  │ (Core SDK)        │───▶│ (Instrumentation Packages)   │    │
│  │                   │    │                              │    │
│  │ • API             │    │ • HTTP, Express              │    │
│  │ • SDK             │    │ • AWS Lambda                 │    │
│  │ • Tracing/Metrics │    │   ⚠️ ESM support incomplete │    │
│  └───────────────────┘    │ • Database drivers           │    │
│                           │ • ...and more                │    │
│                           └──────────────────────────────┘    │
│                                      │                         │
│                 ┌────────────────────┴────────────────┐        │
│                 │                                     │        │
│                 ▼                                     ▼        │
│  ┌──────────────────────────────┐  ┌──────────────────────┐  │
│  │ opentelemetry-lambda ⭐      │  │ aws-otel-lambda      │  │
│  │ (Official Lambda Layer)      │  │ (AWS Distribution)   │  │
│  │                              │  │                      │  │
│  │ • Lambda Layer format        │  │ • Based on left repo │  │
│  │ • ✅ ESM support via         │  │ • Pre-configured     │  │
│  │   import-in-the-middle       │  │ • AWS-specific       │  │
│  │ • Works for .mjs & .js       │  │                      │  │
│  │ • ZERO code changes!         │  │                      │  │
│  └──────────────────────────────┘  └──────────────────────┘  │
│           👆 USE THIS!                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 📦 What Each Repository Does

- **[opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)** - Core SDK and APIs
- **[opentelemetry-js-contrib](https://github.com/open-telemetry/opentelemetry-js-contrib)** - Auto-instrumentation packages (⚠️ ESM support incomplete)
- **[opentelemetry-lambda](https://github.com/open-telemetry/opentelemetry-lambda)** ⭐ - **Official Lambda Layer with ESM support!**
- **[aws-otel-lambda](https://github.com/aws-observability/aws-otel-lambda)** - AWS distribution (based on opentelemetry-lambda)

## 2. The Problem: ESM vs CommonJS

### 🔄 Two Module Systems in Node.js

The fundamental issue is that **Node.js has two completely different module systems**, and OpenTelemetry's instrumentation only works with one of them.

```text
┌──────────────────────────────────────────────────────────┐
│  CommonJS (require)         ESM (import)                 │
│  ✅ Works Today             ❌ Broken                     │
├──────────────────────────────────────────────────────────┤
│  • Synchronous              • Asynchronous                │
│  • Loads at call time       • Parsed before execution    │
│  • Mutable exports          • Immutable exports           │
│  • Easy to patch            • Hard to patch               │
└──────────────────────────────────────────────────────────┘
```

### 📝 Code Comparison

#### CommonJS (Works with OTEL)

```javascript
// handler.js
const handler = async (event, context) => {
  return { statusCode: 200, body: 'Hello!' };
};

module.exports = { handler }; // ✅ Exports to module.exports
```

#### ESM (Broken with OTEL)

```javascript
// handler.mjs
export const handler = async (event, context) => {
  return { statusCode: 200, body: 'Hello!' };
};
// ❌ Named export, NOT in module.exports
// ❌ Not in globalThis
// ❌ Can't be easily patched at runtime
```

### ⚡ The Fundamental Difference: Synchronous vs Asynchronous Loading

ESM loading is **asynchronous**, while CommonJS is **synchronous**. This creates a timing problem for instrumentation:

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│         require() vs import - Execution Model               │
│                                                             │
│  CommonJS (require)              ESM (import)               │
│  ───────────────────             ──────────────             │
│                                                             │
│  SYNCHRONOUS ✅                  ASYNCHRONOUS ⚠️            │
│  ├─ Load module                  ├─ Start module load      │
│  ├─ Execute code                 ├─ Return Promise          │
│  ├─ Return exports               ├─ Continue execution      │
│  └─ All done!                    ├─ ... other code runs    │
│                                  ├─ Module finishes loading │
│  Can patch HERE ✅               └─ Resolve Promise         │
│  ↓                                                          │
│  const mod = require('./mod');   Can't patch here! ❌       │
│  mod.handler = patch(mod.handler)   (Module not ready yet) │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### CommonJS (Synchronous - Patchable)

```javascript
// CommonJS - SYNCHRONOUS (easy to patch)
const instrumentation = new AwsLambdaInstrumentation();
const handlerModule = require('./handler'); // ← Blocks until loaded
// Handler is NOW available - we can patch it!
handlerModule.handler = wrapWithTracing(handlerModule.handler);
```

#### ESM (Asynchronous - Not Patchable)

```javascript
// ESM - ASYNCHRONOUS (hard to patch)
const instrumentation = new AwsLambdaInstrumentation();
const handlerModule = await import('./handler.mjs'); // ← Returns immediately

// But we can't use 'await' in Lambda's initialization!
// And even if we could, ESM exports are IMMUTABLE:
handlerModule.handler = wrapWithTracing(handlerModule.handler); ❌ Error: read-only
```

#### Why ESM Exports Can't Be Patched

```javascript
// Inside handler.mjs
export const handler = async () => { ... }; // ✅ Can define

// Outside handler.mjs (trying to patch)
import { handler } from './handler.mjs';
handler = newFunction; // ❌ TypeError: read-only

// ESM exports are "live bindings" - immutable from outside the module
// Patching MUST happen from inside the module during export
```

### 🔑 The Core Issue: Lambda Runtime Module Loading

**The Lambda runtime has specific code that loads your handler, and understanding this is crucial.**

#### Lambda Runtime Architecture

**Inside every Lambda container, AWS provides a custom Node.js runtime:**

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│            AWS Lambda Container File System                 │
│                                                             │
│  /var/runtime/                                             │
│  ├── index.mjs           ← Main runtime entry point       │
│  ├── bootstrap           ← Runtime initialization         │
│  └── src/                                                  │
│      ├── UserFunction.js ← Handler loading logic ⭐       │
│      ├── Runtime.js      ← Invocation loop                │
│      └── ...                                               │
│                                                             │
│  /var/task/                                                │
│  ├── handler.mjs         ← YOUR code lives here            │
│  ├── package.json                                          │
│  └── node_modules/                                         │
│      └── @opentelemetry/ ← OTEL instrumentation           │
│                                                             │
│  /opt/                                                     │
│  └── (Lambda Layers live here)                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Source Code Reference:**

- Repository: <https://github.com/aws/aws-lambda-nodejs-runtime-interface-client>
- Key File: [`src/UserFunction.js`](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/main/src/UserFunction.js#L288) - This is where handler loading happens
- Entry Point: [`/var/runtime/index.mjs`](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/962ed28eefbc052389c4de4366b1c0c49ee08a13/src/index.mjs#L43-L45) - Runtime initialization

#### Lambda Runtime Source Code

The AWS Lambda runtime for Node.js loads handlers through `/var/runtime/index.mjs`, which internally uses code from `UserFunction.js`. Here's the **actual simplified flow from AWS's source code**:

```javascript
// Simplified from AWS Lambda Runtime - /var/runtime/index.mjs
// Source: https://github.com/aws/aws-lambda-nodejs-runtime-interface-client

class UserFunction {
  async load(handler) {
    // Parse handler string (e.g., "handler.handler" -> module: "handler", function: "handler")
    const [moduleRoot, functionName] = handler.split('.');

    // Lambda determines if it's ESM or CommonJS
    const modulePath = `/var/task/${moduleRoot}`;

    // For ESM files (.mjs):
    const handlerModule = await import(modulePath); // ← Dynamic import!

    // Get the specific function
    const handlerFunction = handlerModule[functionName];

    // ❌ This import happens AFTER OTEL loads
    // ❌ No hooks can intercept this
    // ❌ Handler is immutable after loading

    return handlerFunction;
  }
}
```

#### The Loading Sequence Problem

```text
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│         Lambda Runtime Module Loading Sequence                │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  1. Lambda Runtime Starts                            │    │
│  │     /var/runtime/index.mjs                           │    │
│  │     (AWS proprietary runtime code)                   │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  2. OTEL Instrumentation Loads                       │    │
│  │     (via AWS_LAMBDA_EXEC_WRAPPER)                    │    │
│  │                                                       │    │
│  │     Sets up hooks, waits for handler...              │    │
│  │     ❌ But handler isn't loaded yet!                 │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  3. Lambda Runtime Loads Handler (UserFunction.js)  │    │
│  │                                                       │    │
│  │     // Inside AWS Lambda Runtime:                    │    │
│  │     const module = await import('/var/task/handler.mjs')│
│  │     const handler = module.handler                   │    │
│  │                                                       │    │
│  │     ❌ This dynamic import bypasses our hooks!       │    │
│  │     ❌ Handler never appears in module.exports       │    │
│  │     ❌ Handler never appears in globalThis           │    │
│  │     ❌ ESM exports are immutable after loading       │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  4. Lambda Invokes Handler                           │    │
│  │                                                       │    │
│  │     handler(event, context)                          │    │
│  │                                                       │    │
│  │     😢 No instrumentation applied                    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### Why Lambda's Approach Makes Patching Impossible

Lambda's ESM handler loading bypasses all instrumentation hooks:

```javascript
// Lambda runtime for ESM (simplified from UserFunction.js)
const handlerModule = await import('/var/task/handler.mjs');
const handler = handlerModule.handler;

// We can't intercept this because:
// 1. It happens AFTER our instrumentation loads
// 2. It's a direct import, not going through require()
// 3. ESM exports are read-only "live bindings"
// 4. We can't modify handlerModule.handler from outside the module

// Lambda runtime for CommonJS (works with OTEL)
const handlerModule = require('/var/task/handler.js');
let handler = handlerModule.handler;

// We CAN patch this because:
// 1. require() is synchronous - we can intercept
// 2. module.exports is mutable
// 3. We can replace handlerModule.handler
handler = wrapWithInstrumentation(handler); // ✅ Works!
```

#### Side-by-Side Comparison: Lambda Runtime Behavior

```text
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│         CommonJS Handler (✅)        vs      ESM Handler (❌)        │
│                                                                      │
│  /var/runtime/index.mjs loads:         /var/runtime/index.mjs loads:│
│  ↓                                      ↓                            │
│  const mod = require(                   const mod = await import(    │
│    '/var/task/handler.js'                 'file:///var/task/        │
│  );                                        handler.mjs'              │
│                                         );                           │
│  ✅ Synchronous                         ⚠️  Asynchronous            │
│  ✅ Goes through require()              ❌ Direct import()           │
│  ✅ Uses module.exports                 ❌ Uses ESM exports          │
│  ✅ Exports are mutable                 ❌ Exports are immutable     │
│                                                                      │
│  OTEL can intercept:                    OTEL cannot intercept:       │
│  ↓                                      ↓                            │
│  mod.handler = wrap(mod.handler)        mod.handler = wrap(...)     │
│  ✅ WORKS!                              ❌ TypeError: read-only      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 💡 Why CommonJS Works vs ESM Fails

**CommonJS:**

```javascript
// 1. Instrumentation loads first
const instrumentation = new AwsLambdaInstrumentation();

// 2. Handler module loads
const handlerModule = require('./handler.js');

// 3. Handler is in module.exports - WE CAN PATCH IT!
const originalHandler = handlerModule.handler;
const wrappedHandler = wrapWithTracing(originalHandler);
module.exports.handler = wrappedHandler; // ✅ Patched!
```

**ESM:**

```javascript
// 1. Instrumentation loads first
const instrumentation = new AwsLambdaInstrumentation();

// 2. Try to find the handler...
// ❌ Not in require.cache (ESM doesn't use it)
// ❌ Not in module.exports (ESM doesn't use it)
// ❌ Not in globalThis (named exports don't go there)

// 3. Lambda runtime imports handler directly
// await import('/var/task/handler.mjs')
// ❌ We can't intercept this dynamic import!

// 4. Handler executes WITHOUT instrumentation 😢
```

## 3. Where It Fails

### 📍 Exact Failure Point in Official Package

The official `@opentelemetry/instrumentation-aws-lambda` package has **partial ESM support**:

#### ✅ Part 1: Detection Works ([Source](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/2e639c22e02057daf893c59f3adc954d3c6edea4/packages/instrumentation-aws-lambda/src/instrumentation.ts#L103-L129))

```typescript
// OTEL correctly detects .mjs files
if (!filename.endsWith('.js')) {
  try {
    fs.statSync(`${filename}.js`);
    filename += '.js';
  } catch (e) {
    try {
      fs.statSync(`${filename}.mjs`);
      filename += '.mjs'; // ✅ ESM file detected!
    } catch (e2) {
      try {
        fs.statSync(`${filename}.cjs`);
        filename += '.cjs';
      }
    }
  }
}
```

#### ❌ Part 2: Patching Fails ([Source](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/2e639c22e02057daf893c59f3adc954d3c6edea4/packages/instrumentation-aws-lambda/src/instrumentation.ts#L146-L176))

```typescript
// After detecting .mjs, tries to patch it...
return [
  new InstrumentationNodeModuleDefinition(
    filename, // "handler.mjs"
    ['*'],
    undefined,
    undefined,
    [
      new InstrumentationNodeModuleFile(
        module, // "handler"
        ['*'],
        (moduleExports: LambdaModule) => {
          // ❌ THIS CALLBACK NEVER FIRES FOR ESM!
          // Why? InstrumentationNodeModuleDefinition only hooks require()
          // Lambda uses import() for .mjs files

          this._wrap(moduleExports, functionName, this._getHandler(...));
          return moduleExports;
        }
      ),
    ]
  ),
];

// The root cause:
// InstrumentationNodeModuleDefinition is designed for CommonJS (require())
// It hooks into require() calls, but ESM uses import()
// When Lambda loads handler.mjs via import(), this hook never fires!
```

### 🔍 Visual Breakdown of the Failure

```text
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│        Current OTEL AWS Lambda Instrumentation Flow           │
│                                                                │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 1: Detect Handler File Type             │           │
│  │                                                │           │
│  │  _HANDLER = "handler.handler"                 │           │
│  │  Check for: handler.mjs ✅ Found!             │           │
│  │                                                │           │
│  │  File detection works correctly!              │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 2: Setup Module Definition Hook         │           │
│  │                                                │           │
│  │  InstrumentationNodeModuleDefinition(         │           │
│  │    filename: "handler.mjs",                   │           │
│  │    patch: (moduleExports) => { ... }          │           │
│  │  )                                             │           │
│  │                                                │           │
│  │  ✅ Hook registered successfully              │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 3: Lambda Loads Handler                 │           │
│  │                                                │           │
│  │  Lambda Runtime executes:                     │           │
│  │  await import('/var/task/handler.mjs')        │           │
│  │                                                │           │
│  │  ❌ Hook doesn't fire! Why?                   │           │
│  │  • InstrumentationNodeModuleDefinition only   │           │
│  │    intercepts require() calls                 │           │
│  │  • Lambda uses import() for .mjs files        │           │
│  │  • The hook never sees the module load!       │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 4: Patch Callback Never Executes        │           │
│  │                                                │           │
│  │  (moduleExports) => {                         │           │
│  │    // This code NEVER runs for ESM!          │           │
│  │    this._wrap(moduleExports, ...)            │           │
│  │  }                                             │           │
│  │                                                │           │
│  │  ❌ moduleExports is undefined                │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Result: Handler Runs Uninstrumented 😢       │           │
│  │                                                │           │
│  │  Lambda successfully invokes handler.mjs      │           │
│  │  But without any OpenTelemetry tracing!       │           │
│  └────────────────────────────────────────────────┘           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Root Cause:**

`InstrumentationNodeModuleDefinition` hooks `require()` calls, but Lambda uses `import()` for `.mjs` files, so the hook never fires and the handler remains unpatched.

## 4. Solutions

We tried **7 different approaches**. Here's what worked and what didn't:

---

### ✅ Solution 1: Manual Instrumentation

**Approach:** Add tracing code directly in each handler.

```javascript
// handler.mjs
import { trace } from '@opentelemetry/api';

export const handler = async (event, context) => {
  const tracer = trace.getTracer('my-service');
  const span = tracer.startSpan('handler');

  try {
    // Your code
    return { statusCode: 200, body: 'Hello!' };
  } finally {
    span.end();
  }
};
```

**Result:**

- ✅ Works - Traces are generated
- ❌ Not maintainable - Must modify every handler
- ❌ Boilerplate code in every function
- ❌ Easy to forget when creating new functions
- ❌ Doesn't instrument AWS SDK or HTTP calls automatically

```text
┌────────────────────────────────────────────────────────┐
│  Pros                  │  Cons                         │
├────────────────────────┼───────────────────────────────┤
│  ✓ Works immediately   │  ✗ Code in every handler      │
│  ✓ Full control        │  ✗ Hard to maintain           │
│  ✓ Simple to understand│  ✗ Easy to forget             │
│                        │  ✗ No auto-instrumentation    │
└────────────────────────┴───────────────────────────────┘
```

**Verdict:** ⚠️ Works but not scalable

---

### ✅ Solution 2: esbuild Banner (RECOMMENDED)

**Approach:** Inject instrumentation setup at build time, handlers patch themselves.

#### Configuration

##### Step 1: Add Banner to serverless.yml

```yaml
# serverless.yml
custom:
  esbuild:
    banner:
      js: |
        import { createRequire } from 'module';
        const require = createRequire(import.meta.url);
        import { fileURLToPath } from 'url';
        import { dirname } from 'path';

        // Setup CommonJS globals (required by OTEL packages)
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        globalThis.__dirname = __dirname;
        globalThis.__filename = __filename;

        // Since ESM exports are immutable, we provide a patcher function you can use
        if (globalThis.__aws_lambda_esm_instrumentation) {
          globalThis.__patchESMHandler = (fn, name = 'handler') => {
            try {
              return globalThis.__aws_lambda_esm_instrumentation
                .patchESMHandler(fn, name);
            } catch (error) {
              console.error('Failed to patch:', error.message);
              return fn; // Fallback to original
            }
          };
        }
```

**What This Banner Does:**

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│           Banner Injection - Execution Order               │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  1. createRequire()                          │         │
│  │     Makes CommonJS require() available       │         │
│  │     Many OTEL packages still expect this     │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  2. Setup __dirname and __filename           │         │
│  │     ESM doesn't have these globals           │         │
│  │     Some packages expect them                │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  3. Create globalThis.__patchESMHandler      │         │
│  │     This is the key function!                │         │
│  │     Allows handler to patch itself           │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  4. Your handler code runs                   │         │
│  │     Can call __patchESMHandler()             │         │
│  │     Patches itself during export             │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### How It Works

```text
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│              esbuild Banner Injection Process                │
│                                                              │
│  ┌────────────────┐                                         │
│  │  Source Code   │                                         │
│  │  handler.mjs   │                                         │
│  └───────┬────────┘                                         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────────────────────────────────────┐         │
│  │  esbuild Bundles                               │         │
│  │                                                │         │
│  │  1. Add banner code (OTEL setup)              │         │
│  │  2. Add your handler code                     │         │
│  │  3. Bundle into single file                   │         │
│  └───────┬────────────────────────────────────────┘         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────────────────────────────────────┐         │
│  │  Bundled Output                                │         │
│  │                                                │         │
│  │  // Banner code runs first                    │         │
│  │  import { trace } from '@opentelemetry/api';  │         │
│  │  registerInstrumentations(...);               │         │
│  │                                                │         │
│  │  // Your handler code runs after              │         │
│  │  export const handler = async () => {...}     │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Handler Modification Required

##### Step 2: Update Your Handler

The key insight: Since ESM exports are immutable from the outside, we must **patch from the inside** during the export itself.

```javascript
// handler.mjs - New pattern for ESM with OTEL

// Define handler (business logic unchanged)
async function originalHandler(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' }),
  };
}

// Self-patching export (only line that changes)
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

**Why It Works:**

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│         Handler Self-Patching Flow                         │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  1. Handler file loads                       │         │
│  │     async function originalHandler() {...}   │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  2. Export statement executes                │         │
│  │     Check: Does __patchESMHandler exist?     │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│        ┌──────┴──────┐                                    │
│        │             │                                    │
│  ✅ YES│             │NO ❌                               │
│        │             │                                    │
│        ▼             ▼                                    │
│  ┌──────────┐  ┌──────────────┐                          │
│  │  Patch & │  │  Export      │                          │
│  │  Export  │  │  Original    │                          │
│  │  Wrapped │  │  (Fallback)  │                          │
│  └──────────┘  └──────────────┘                          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

```text
Build Time:
  esbuild adds banner → Creates __patchESMHandler function

Runtime:
  Handler loads → Export calls __patchESMHandler → ✅ Patched!
```

**Benefits of This Approach:**

1. **Minimal Changes** - Only the export line changes
2. **Safe Fallback** - Works even if instrumentation isn't loaded
3. **Self-Contained** - Each handler patches itself
4. **Type-Safe** - TypeScript still works correctly
5. **Testable** - Can still test the original function directly

**Result:**

- ✅ Works reliably - Instrumentation applied to all handlers
- ✅ Minimal handler changes - Only the export line
- ✅ Auto-instruments AWS SDK and HTTP calls
- ✅ Safe fallback - Works without instrumentation (local dev)
- ⚠️ Requires build configuration - One-time serverless.yml change
- ⚠️ Pattern change needed - Must use the export pattern

```text
┌────────────────────────────────────────────────────────┐
│  Pros                  │  Cons                         │
├────────────────────────┼───────────────────────────────┤
│  ✓ Works reliably      │  ✗ Build config changes       │
│  ✓ Auto-instrumentation│  ✗ Export pattern change      │
│  ✓ One-time setup      │  ✗ esbuild-specific           │
│  ✓ Maintainable        │  ✗ Not 100% zero-code change  │
│  ✓ Safe fallback       │                               │
│  ✓ Type-safe           │                               │
└────────────────────────┴───────────────────────────────┘
```

**Verdict:** ✅ Best working solution - Production-ready

---

### ⚠️ Solution 3: CommonJS Shim Wrapper

**Approach:** Create a CommonJS wrapper that imports the ESM handler, allowing OTEL to patch the wrapper.

#### The Strategy

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              CJS Shim Wrapper Flow                         │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  1. Lambda loads shim-wrapper.cjs            │         │
│  │     (CommonJS file)                          │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  2. OTEL hooks into require()                │         │
│  │     ✅ Patches shim-wrapper.handler          │         │
│  │     (Because it's CommonJS!)                 │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  3. Shim wrapper invoked                     │         │
│  │     ✅ OTEL tracing wrapper active!          │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  4. Shim imports ESM handler                 │         │
│  │     const esm = await import('./handler.mjs')│         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  5. Shim calls ESM handler                   │         │
│  │     return await esmHandler(event, context)  │         │
│  │     ✅ All within OTEL trace span!           │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**File Structure:**

```text
your-lambda/
├── shim-wrapper.cjs    ← CommonJS wrapper (OTEL patches this)
├── handler.mjs         ← Your ESM handler (unchanged)
├── package.json
└── serverless.yml      ← Points to shim, not handler!
```

**Step 1: Create the Shim Wrapper**

```javascript
// shim-wrapper.cjs (NEW FILE - CommonJS)
module.exports.handler = async function shimHandler(event, context) {
  // This wrapper is CommonJS, so OTEL can patch it!
  // Import the actual ESM handler at runtime
  const esmModule = await import('./handler.mjs');

  // Call the ESM handler - everything happens within OTEL's trace!
  return await esmModule.handler(event, context);
};
```

**Step 2: Your Handler (No Changes)**

```javascript
// handler.mjs (UNCHANGED - pure ESM)
export const handler = async (event, context) => {
  // Your business logic - no modifications needed!
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' }),
  };
};
```

**Step 3: Configure Lambda to Use Shim**

```yaml
# serverless.yml - Point to shim instead of handler
functions:
  myFunction:
    # ⭐ CRITICAL: Point to shim-wrapper, NOT handler
    handler: shim-wrapper.handler # ← Changed from "handler.handler"
```

**The Magic:**

```text
_HANDLER=shim-wrapper.handler
    ↓
Lambda loads shim-wrapper.cjs (CommonJS)
    ↓
✅ OTEL patches it (because it's CommonJS)
    ↓
Shim imports handler.mjs dynamically
    ↓
✅ ESM handler runs within OTEL trace
```

**The Deployment Blocker:**

```text
┌────────────────────────────────────────────────────────┐
│                                                        │
│         Why It Failed in Production                    │
│                                                        │
│  ┌──────────────────────────────────────────┐         │
│  │  Our Build Pipeline                      │         │
│  │                                          │         │
│  │  serverless-esbuild:                     │         │
│  │  ├─ Configured for ESM (type: "module") │         │
│  │  ├─ Bundles .mjs files                  │         │
│  │  └─ ❌ Cannot bundle .cjs files!        │         │
│  │                                          │         │
│  │  Error: Cannot use .cjs with ESM mode   │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  Our esbuild config requires ESM format,              │
│  but the shim MUST be CommonJS for OTEL to work.     │
│                                                        │
│  Incompatibility: ESM bundler ≠ CJS shim             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Result:**

- ✅ **Works perfectly in RIE** - Full instrumentation
- ✅ **No handler changes** - ESM handler stays pure
- ✅ **Clean separation** - Shim handles instrumentation
- ❌ **Can't deploy** - Incompatible with our esbuild ESM configuration
- ❌ **Build pipeline conflict** - Would need to support both ESM and CJS

```text
┌────────────────────────────────────────────────────────┐
│  Pros                  │  Cons                         │
├────────────────────────┼───────────────────────────────┤
│  ✓ Works in RIE        │  ✗ Incompatible with esbuild  │
│  ✓ No handler changes  │  ✗ Can't use ESM bundler      │
│  ✓ Clean architecture  │  ✗ Production deployment fails│
│  ✓ Full instrumentation│  ✗ Build pipeline blocker     │
└────────────────────────┴───────────────────────────────┘
```

**Verdict:** ⚠️ **Works in testing but blocked by build pipeline requirements**

---

### ❌ Solution 4: Custom Runtime Patching

**Approach:** Create a custom OpenTelemetry instrumentation package that attempts to patch handlers at runtime using various interception strategies.

#### The Strategy

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│        Custom Instrumentation Patching Strategies         │
│                                                            │
│  Strategy 1: Aggressive Monitoring                        │
│  ┌──────────────────────────────────────────────┐         │
│  │  Poll every 50ms for 30 seconds             │         │
│  │  Check:                                      │         │
│  │  • globalThis.handler                       │         │
│  │  • module.exports.handler                   │         │
│  │  • require.cache entries                    │         │
│  │                                              │         │
│  │  ❌ Handler never appears in any of these!  │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  Strategy 2: Object.defineProperty Interception           │
│  ┌──────────────────────────────────────────────┐         │
│  │  Override Object.defineProperty globally    │         │
│  │  Intercept any property assignments         │         │
│  │                                              │         │
│  │  ❌ ESM exports don't use defineProperty!   │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  Strategy 3: Module Registry Inspection                   │
│  ┌──────────────────────────────────────────────┐         │
│  │  Monitor Node's internal module cache       │         │
│  │  Look for handler module in registry        │         │
│  │                                              │         │
│  │  ❌ ESM modules use different registry!     │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  Strategy 4: Function.prototype.call Interception         │
│  ┌──────────────────────────────────────────────┐         │
│  │  Override Function.prototype.call           │         │
│  │  Catch when Lambda runtime calls handler    │         │
│  │                                              │         │
│  │  ❌ Caused stack overflow! Too aggressive   │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**The Core Issue:**

```text
ESM handlers are:
  ❌ Not in globalThis
  ❌ Not in module.exports
  ❌ Not in require.cache
  ❌ Immutable from outside

  No runtime patching point exists!
```

**Result:**

- ❌ Failed - Handler never found for patching
- ✅ Learned about Node.js module systems and Lambda runtime internals
- ❌ Root cause: Lambda runtime bypasses all our hooks

```text
┌────────────────────────────────────────────────────────┐
│  Attempted Hooks      │  Why It Failed                 │
├───────────────────────┼────────────────────────────────┤
│  globalThis           │  ESM exports don't go there    │
│  module.exports       │  ESM doesn't use it            │
│  require.cache        │  ESM has separate cache        │
│  Object.defineProperty│  ESM uses different mechanism  │
│  Function.call        │  Too aggressive, stack overflow│
└───────────────────────┴────────────────────────────────┘
```

**Verdict:** ❌ **Failed** - Lambda runtime architecture prevents this

---

### ⚠️ Solution 5: Building Official ADOT Lambda Layer

**Approach:** Use AWS's official OpenTelemetry distribution (ADOT) as a Lambda Layer.

#### What is ADOT?

AWS Distro for OpenTelemetry (ADOT) is Amazon's supported distribution of OpenTelemetry, pre-packaged as Lambda Layers.

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              ADOT Lambda Layer Structure                   │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  /opt/                                       │         │
│  │  ├── nodejs/                                 │         │
│  │  │   └── node_modules/                       │         │
│  │  │       ├── @opentelemetry/                 │         │
│  │  │       ├── @aws/aws-distro-opentelemetry/  │         │
│  │  │       └── ...                              │         │
│  │  │                                            │         │
│  │  ├── otel-handler (wrapper script)           │         │
│  │  └── bootstrap (runtime wrapper)             │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  Lambda Configuration:                                    │
│  • AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler             │
│  • Layer ARN: arn:aws:lambda:region:...                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### Deployment Process

```bash
# 1. Add ADOT layer to Lambda function
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-...

# 2. Set environment variables
export AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
```

**Result:**

- ⚠️ Inconclusive - Layer loads but no traces appeared
- ❌ ESM support unclear - Documentation doesn't mention .mjs
- ❌ Black box - Hard to debug what's happening inside
- ⚠️ Still in development - ESM support not officially released

```text
┌────────────────────────────────────────────────────────┐
│  Observed Behavior     │  Explanation                  │
├────────────────────────┼───────────────────────────────┤
│  Layer loads ✓         │  No errors during init        │
│  Handler executes ✓    │  Function works normally      │
│  No traces ✗           │  Nothing sent to collector    │
│  No errors ✗           │  Silent failure               │
└────────────────────────┴───────────────────────────────┘
```

**Verdict:** ⚠️ **Inconclusive - May work in future as ADOT matures**

---

### ✅ Solution 6: OpenTelemetry Lambda Layer (RECOMMENDED FOR ZERO-CODE)

**Approach:** Use the official OpenTelemetry Lambda Layer from [`opentelemetry-lambda`](https://github.com/open-telemetry/opentelemetry-lambda) repository.

**🎉 This is the BEST solution for ESM - it works with ZERO code changes!**

#### How It Works

The `opentelemetry-lambda` repository solves ESM instrumentation using a **dual-mode approach**:

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│        OpenTelemetry Lambda Layer Architecture             │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  1. otel-handler script runs                 │         │
│  │     export NODE_OPTIONS="--import /opt/init" │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  2. init.mjs loads BEFORE your handler       │         │
│  │     • Initializes OpenTelemetry SDK          │         │
│  │     • Detects if handler is ESM or CJS       │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│        ┌──────┴──────┐                                    │
│   ESM? │             │ CJS?                               │
│   ┌────▼────┐   ┌────▼────┐                              │
│   │loader.mjs│   │Standard │                              │
│   │         │   │OTel Hook│                              │
│   └────┬────┘   └────┬────┘                              │
│        │             │                                    │
│        ▼             ▼                                    │
│  ┌──────────┐ ┌──────────────┐                           │
│  │import-in-│ │require() hook│                           │
│  │the-middle│ │(traditional) │                           │
│  └────┬─────┘ └──────┬───────┘                           │
│       │              │                                    │
│       ▼              ▼                                    │
│  ✅ Patches     ✅ Patches                                │
│     ESM            CJS                                    │
│     handlers       handlers                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**The Key Innovation:**

Instead of relying on `InstrumentationNodeModuleDefinition` (which only works with `require()`), the layer uses:

- **For CommonJS**: Standard OTel instrumentation ✅
- **For ESM**: `import-in-the-middle` with `--import` flag ✅

#### Deployment (Zero Code Changes!)

```bash
# 1. Add the OpenTelemetry Lambda Layer
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:184161586896:layer:opentelemetry-nodejs:latest

# 2. Set the wrapper
aws lambda update-function-configuration \
  --function-name my-function \
  --environment Variables="{AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler}"
```

**Your Handler (No Changes Needed!):**

```javascript
// handler.mjs - Pure ESM, ZERO modifications!
export const handler = async (event, context) => {
  // Your business logic - automatically instrumented
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' }),
  };
};
```

**Why This Works:**

```text
1. --import flag loads init.mjs FIRST (before handler)
2. init.mjs detects ESM handler
3. Registers import-in-the-middle hook
4. Lambda loads handler.mjs via import()
5. Hook intercepts the import() ✅
6. Handler gets patched ✅
7. Full instrumentation with zero code changes! 🎉
```

**Result:**

- ✅ **Works perfectly!** - Full instrumentation for ESM handlers
- ✅ **ZERO code changes** - No handler modifications needed
- ✅ **No build configuration** - No banner or special setup
- ✅ **Production-ready** - Official OpenTelemetry solution
- ✅ **Works for both** - Handles CommonJS AND ESM seamlessly

**Verdict:** ✅ **BEST SOLUTION - Production-ready, zero-code, official support**

**Repository:** https://github.com/open-telemetry/opentelemetry-lambda

---

### ⚠️ Solution 7: ADOT-Style Custom Implementation

**Approach:** Reverse-engineer ADOT's structure and use `import-in-the-middle` to intercept ESM imports.

#### The Theory

The ADOT layer uses a library called `import-in-the-middle` which can intercept dynamic `import()` calls:

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│         ADOT-Style ESM Interception Flow                   │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  Step 1: Register --experimental-loader      │         │
│  │                                              │         │
│  │  NODE_OPTIONS="--experimental-loader         │         │
│  │    /opt/nodejs/node_modules/                 │         │
│  │    import-in-the-middle/hook.mjs"            │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  Step 2: Register import hooks               │         │
│  │                                              │         │
│  │  import { addHook } from 'import-in-middle'; │         │
│  │  addHook((exports, name, baseDir) => {      │         │
│  │    if (exports.handler) {                   │         │
│  │      exports.handler = wrap(exports.handler)│         │
│  │    }                                         │         │
│  │    return exports;                           │         │
│  │  });                                         │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  Step 3: Lambda imports handler.mjs          │         │
│  │                                              │         │
│  │  await import('/var/task/handler.mjs')      │         │
│  │                                              │         │
│  │  ✓ Hook intercepts this import!             │         │
│  │  ✓ We see the exports object!               │         │
│  └────────────┬─────────────────────────────────┘         │
│               │                                            │
│               ▼                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  Step 4: Patch the handler                   │         │
│  │                                              │         │
│  │  exports.handler = wrapWithTracing(         │         │
│  │    exports.handler                           │         │
│  │  );                                          │         │
│  │                                              │         │
│  │  ✓ Handler is now instrumented!             │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### Implementation Attempt

```javascript
// wrapper.mjs (loaded via --import flag)
import { addHook } from 'import-in-the-middle';

addHook((exports, name, baseDir) => {
  if (exports.handler) {
    // Try to patch the handler
    exports.handler = wrapWithTracing(exports.handler);
  }
  return exports;
});
```

#### The Reality

```text
┌────────────────────────────────────────────────────────┐
│                                                        │
│         What Actually Happened                         │
│                                                        │
│  ┌──────────────────────────────────────┐             │
│  │  ✅ Wrapper loaded successfully      │             │
│  └────────────┬─────────────────────────┘             │
│               │                                        │
│               ▼                                        │
│  ┌──────────────────────────────────────┐             │
│  │  ✅ import-in-the-middle registered  │             │
│  └────────────┬─────────────────────────┘             │
│               │                                        │
│               ▼                                        │
│  ┌──────────────────────────────────────┐             │
│  │  ✅ Hook sees handler.mjs import     │             │
│  │  ✅ Hook sees exports object         │             │
│  │  ✅ exports.handler exists!          │             │
│  └────────────┬─────────────────────────┘             │
│               │                                        │
│               ▼                                        │
│  ┌──────────────────────────────────────┐             │
│  │  ❌ Hook tries to patch...           │             │
│  │                                      │             │
│  │  ERROR: Timing issues               │             │
│  │  • Lambda loads handler differently │             │
│  │  • Hook sees exports but can't patch│             │
│  │  • export is immutable in some cases│             │
│  └──────────────────────────────────────┘             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Issues Encountered:**

1. **`name` parameter inconsistency** - Sometimes string, sometimes object
2. **Exports object immutability** - Can't always reassign properties
3. **Timing issues** - Hook runs but Lambda uses different handler reference
4. **Type errors** - `import-in-the-middle` API behaves differently than expected

**Result:**

- ⚠️ Partially successful - Hook sees the handler
- ❌ Can't patch reliably - Exports modification doesn't stick
- ✅ Proved the concept - Import interception IS possible
- ❌ Not production-ready - Too many edge cases

```text
┌────────────────────────────────────────────────────────┐
│  What Worked          │  What Didn't                   │
├───────────────────────┼────────────────────────────────┤
│  ✓ Hook registration  │  ✗ Reliable patching           │
│  ✓ Module detection   │  ✗ Exports modification        │
│  ✓ Export visibility  │  ✗ Production stability        │
└───────────────────────┴────────────────────────────────┘
```

**Verdict:** ⚠️ **Promising but not reliable enough for production**

---

## 5. Testing with Lambda RIE

### 🐳 Lambda Runtime Interface Emulator (RIE)

RIE is a Docker-based tool that **emulates AWS Lambda runtime locally**.

```text
┌────────────────────────────────────────────────────┐
│  Local Machine                                     │
│  ┌──────────────────────────────────────────┐     │
│  │  Docker Container                        │     │
│  │  ┌────────────────────────────────────┐  │     │
│  │  │  Lambda RIE                        │  │     │
│  │  │  • Mimics AWS Lambda runtime       │  │     │
│  │  │  • Same module loading             │  │     │
│  │  │  • Same environment                │  │     │
│  │  │  ↓                                 │  │     │
│  │  │  Your Handler + OTEL               │  │     │
│  │  └────────────────────────────────────┘  │     │
│  └──────────────────────────────────────────┘     │
└────────────────────────────────────────────────────┘
```

**Why RIE Was Essential:**

```text
┌─────────────────────────┬─────────────────────────┐
│  With RIE               │  Without RIE (AWS)      │
├─────────────────────────┼─────────────────────────┤
│  ✓ Instant feedback     │  ✗ 30s+ deploy cycle    │
│  ✓ Full log access      │  ✗ CloudWatch delay     │
│  ✓ Easy debugging       │  ✗ Limited visibility   │
│  ✓ No costs             │  ✗ Costs per test       │
│  ✓ Reproducible         │  ✗ Environment drift    │
└─────────────────────────┴─────────────────────────┘
```

**Our Test Setup:**

```bash
# test/rie/
docker-compose up                    # Start Lambda RIE
curl -X POST http://localhost:9000  # Invoke function
docker-compose logs                 # Check instrumentation logs
```

**Key Finding from RIE:**

The logs showed that no matter what hook we tried, ESM handlers **never appeared in any patchable location**:

```text
🔧 [INSTRUMENTATION] Monitoring for handler: handler
🔄 Monitoring check 20/600... handler: handler
🔄 Monitoring check 40/600... handler: handler
...
[handler.mjs] Function invoked ← Handler runs successfully
...
🔄 Monitoring check 600/600... handler: handler
❌ Could not find handler after 30 seconds
```

**Key Insight:** RIE showed us that the handler executes successfully BUT never appears in any of the locations we're checking (globalThis, module.exports, require.cache).

---

## 6. Recommendations

### 📊 Solution Comparison

```text
┌────────────────┬──────┬─────────┬───────────┬─────────────┐
│ Solution       │Works │Effort   │Code Chg   │Recommend    │
├────────────────┼──────┼─────────┼───────────┼─────────────┤
│ 1. Manual      │  ✅  │ Low     │ High      │ ❌ No       │
│ 2. esbuild     │  ✅  │ Medium  │ Minimal   │ ✅ Good     │
│ 3. CJS Shim    │  ✅* │ Medium  │ None      │ ⚠️ Build    │
│                │ RIE  │         │           │   Conflict  │
│ 4. Custom      │  ❌  │ High    │ N/A       │ ❌ No       │
│    Runtime     │      │         │           │             │
│ 5. ADOT Layer  │  ⚠️  │ Low     │ None      │ ⚠️ Unclear  │
│ 6. OTEL Lambda │  ✅  │ Low     │ None      │ ✅ BEST!    │
│    Layer       │      │         │           │             │
│ 7. ADOT-style  │  ⚠️  │ High    │ N/A       │ ❌ No       │
│    Custom      │      │         │           │             │
└────────────────┴──────┴─────────┴───────────┴─────────────┘

* CJS Shim works in RIE but incompatible with ESM esbuild pipeline
```

### 🎯 PRIMARY RECOMMENDATION: OpenTelemetry Lambda Layer

**Use the official [`opentelemetry-lambda`](https://github.com/open-telemetry/opentelemetry-lambda) layer for ZERO code changes!**

```bash
# 1. Add the layer
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:184161586896:layer:opentelemetry-nodejs:latest

# 2. Set the wrapper
aws lambda update-function-configuration \
  --function-name my-function \
  --environment Variables="{AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler}"

# Done! Your ESM handlers are now automatically instrumented.
```

**Why This is Best:**

- ✅ Zero code changes
- ✅ Zero build configuration
- ✅ Official OpenTelemetry solution
- ✅ Production-ready

---

### 🎯 ALTERNATIVE: esbuild Banner Approach

**If you can't use Lambda Layers (e.g., organizational restrictions), use the esbuild banner approach:**

**1. Update serverless.yml:**

```yaml
custom:
  esbuild:
    banner:
      js: |
        import { createRequire } from 'module';
        const require = createRequire(import.meta.url);
        import { fileURLToPath } from 'url';
        import { dirname } from 'path';

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        globalThis.__dirname = __dirname;
        globalThis.__filename = __filename;

        if (globalThis.__aws_lambda_esm_instrumentation) {
          globalThis.__patchESMHandler = (fn, name = 'handler') => {
            try {
              return globalThis.__aws_lambda_esm_instrumentation
                .patchESMHandler(fn, name);
            } catch (error) {
              console.error('Failed to patch:', error.message);
              return fn;
            }
          };
        }
```

**2. Update Handler Export Pattern:**

```javascript
// handler.mjs

// Your business logic (completely unchanged)
async function originalHandler(event, context) {
  const result = await processEvent(event);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

// Only this export line changes:
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

**Why This Works:**

```text
┌────────────────────────────────────────────────────────┐
│                                                        │
│  Build Time              Runtime                       │
│  ──────────              ───────                       │
│                                                        │
│  esbuild bundles   →    Banner code runs first        │
│  banner code             ↓                            │
│  +                       Creates __patchESMHandler    │
│  handler code            ↓                            │
│                          Handler loads & exports      │
│                          ↓                            │
│                          Export calls __patchESMHandler│
│                          ↓                            │
│                          ✅ Instrumented handler!     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 🔮 Future Outlook

**Watch for these developments:**

1. **ADOT Layer ESM Support** - AWS is actively developing this

   - Monitor: <https://github.com/aws-observability/aws-otel-lambda>
   - Once stable, switch from banner approach to ADOT layer

2. **OpenTelemetry ESM Native Support** - The OTel community is working on this

   - Track issue: <https://github.com/open-telemetry/opentelemetry-js-contrib/issues>

3. **Node.js ESM Improvements** - Better hooks for module interception

   - As Node.js matures its ESM support, more solutions may become possible

4. **OTEL Open source community** - Share findings with wider OTEL community. Can hopefully garner assistance from OTEL and NODE SME on best approach.

### 💡 Key Takeaways

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  What We Learned About ESM + Lambda + OTEL                │
│                                                            │
│  1. ✅ SOLUTION EXISTS!                                   │
│     opentelemetry-lambda layer works with ZERO changes    │
│                                                            │
│  2. ESM ≠ CommonJS                                        │
│     Different loading, timing, and mutability             │
│                                                            │
│  3. Lambda Runtime Loads via import()                     │
│     Standard OTel hooks (require()) don't work            │
│                                                            │
│  4. The Right Approach: --import Flag                     │
│     Load instrumentation BEFORE handler using Node flags  │
│                                                            │
│  5. import-in-the-middle is Key                           │
│     This library can intercept ESM import() calls         │
│                                                            │
│  6. RIE is Essential                                      │
│     Local testing saved countless hours                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 🎯 The Discovery

After extensive testing, we discovered that the **`opentelemetry-lambda`** repository (separate from `opentelemetry-js-contrib`) already has a working ESM solution using:

1. `--import` flag to load instrumentation first
2. `import-in-the-middle` to hook ESM imports
3. Dual-mode detection (ESM vs CommonJS)

This is the **official OpenTelemetry solution** and works perfectly with zero code changes!

---

## 📚 References

**Primary Solution:**

- **[OpenTelemetry Lambda](https://github.com/open-telemetry/opentelemetry-lambda)** ⭐ - Official Lambda Layer with ESM support

**Related Repositories:**

- [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) - Core SDK
- [OpenTelemetry JS Contrib](https://github.com/open-telemetry/opentelemetry-js-contrib) - Instrumentation packages
- [AWS Lambda Runtime Client](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client) - Runtime source code
- [AWS ADOT Lambda](https://github.com/aws-observability/aws-otel-lambda) - AWS distribution

**Tools & Documentation:**

- [Lambda RIE Docs](https://docs.aws.amazon.com/lambda/latest/dg/images-test.html) - Local testing
- [Node.js ESM Docs](https://nodejs.org/api/esm.html) - ESM specification
- [import-in-the-middle](https://github.com/DataDog/import-in-the-middle) - ESM import hooking

---

**Version:** 1.0.0
**Last Updated:** October 2025
**Author:** Emmanuel Adu

_This document represents extensive investigation and experimentation. We hope it helps your ESM instrumentation journey!_






# OpenTelemetry ESM Lambda Instrumentation

This PR adds OpenTelemetry auto-instrumentation for AWS Lambda functions with **full ESM support**. Zero code changes required - just add the layer and environment variables.

## 🚀 Key Features

- ✅ **Full ESM Support** - Works with `.mjs` files and `"type": "module"`
- ✅ **Zero Code Changes** - Just add layer + environment variables
- ✅ **Auto-Instrumentation** - HTTP, AWS SDK, databases, GraphQL, gRPC, etc.
- ✅ **Performance Optimized** - Minimal cold start overhead

## 🔧 How ESM Works

**Problem**: Standard OpenTelemetry only hooks `require()` calls, but AWS Lambda loads ESM handlers using `import()`.

**Solution**: This layer uses `import-in-the-middle` library to hook ESM `import()` calls:

1. **Detects ESM handlers** - `.mjs` files or `"type": "module"` in package.json
2. **Registers ESM hook** - Only when needed (zero overhead for CommonJS)
3. **Intercepts imports** - Captures ESM module loading for instrumentation
4. **Works alongside standard OTel** - Seamless integration

## 📊 Enabled Instrumentations

| Instrumentation | What It Traces                | Status           |
| --------------- | ----------------------------- | ---------------- |
| **aws-lambda**  | Lambda execution, cold starts | ✅ Always Active |
| **aws-sdk**     | S3, DynamoDB, SQS, SNS, etc.  | ✅ Always Active |
| **dns**         | DNS lookups and resolutions   | ✅ Enabled       |
| **graphql**     | GraphQL query execution       | ✅ Enabled       |
| **grpc**        | gRPC service calls            | ✅ Enabled       |
| **http**        | HTTP requests/responses       | ✅ Enabled       |
| **net**         | TCP connections, IPC          | ✅ Enabled       |
| **pg**          | PostgreSQL queries            | ✅ Enabled       |
| **redis**       | Redis operations              | ✅ Enabled       |
| **pino**        | Pino logging calls            | ✅ Enabled       |

**Available but disabled**: express, koa, hapi, mongodb, mysql, kafka, etc. (30+ total)

## 🎛️ Configuration

### Environment Variables

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_NODE_ENABLED_INSTRUMENTATIONS=dns,graphql,grpc,http,net,pg,redis,pino
```
