# 🚀 The Journey to ESM Lambda Instrumentation with OpenTelemetry

> A technical deep-dive into instrumenting ECMAScript Module (ESM) Lambda functions with OpenTelemetry

---

## 📚 Table of Contents

1. [Background: The OpenTelemetry Ecosystem](#1-background-the-opentelemetry-ecosystem)
2. [The Problem: ESM vs CommonJS](#2-the-problem-esm-vs-commonjs)
3. [Where the Current Solution Fails](#3-where-the-current-solution-fails)
4. [Solution Attempts: What We Tried](#4-solution-attempts-what-we-tried)
5. [Testing with Lambda RIE](#5-testing-with-lambda-rie)
6. [Conclusion & Recommendations](#6-conclusion--recommendations)

---

## 1. Background: The OpenTelemetry Ecosystem

### 🏗️ The OpenTelemetry Repository Structure

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  OpenTelemetry for JavaScript Ecosystem                    │
│                                                             │
│  ┌───────────────────────┐    ┌─────────────────────────┐ │
│  │                       │    │                         │ │
│  │  opentelemetry-js     │    │ opentelemetry-js-       │ │
│  │  (Core Repository)    │───▶│ contrib                 │ │
│  │                       │    │ (Instrumentation)       │ │
│  │  • API                │    │                         │ │
│  │  • SDK                │    │ • HTTP                  │ │
│  │  • Core Functionality │    │ • Express               │ │
│  │                       │    │ • AWS Lambda ⭐         │ │
│  │                       │    │ • ...and more           │ │
│  └───────────────────────┘    └─────────────────────────┘ │
│                                         │                  │
│                                         ▼                  │
│                          ┌─────────────────────────────┐  │
│                          │                             │  │
│                          │  aws-otel-js-               │  │
│                          │  instrumentation            │  │
│                          │  (AWS Distribution)         │  │
│                          │                             │  │
│                          │  • Pre-configured for AWS   │  │
│                          │  • Lambda Layer format      │  │
│                          │  • 🚧 Under construction   │  │
│                          │                             │  │
│                          └─────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 📦 What Each Repository Does

**1. `opentelemetry-js`** ([GitHub](https://github.com/open-telemetry/opentelemetry-js))

- The **core** OpenTelemetry JavaScript SDK
- Provides the fundamental APIs for tracing, metrics, and context propagation
- Think of it as the **engine** that powers observability

**2. `opentelemetry-js-contrib`** ([GitHub](https://github.com/open-telemetry/opentelemetry-js-contrib))

- Contains **automatic instrumentation** for popular frameworks and services
- Each package auto-instruments a specific technology (Express, AWS Lambda, etc.)
- The **@opentelemetry/instrumentation-aws-lambda** package lives here
- Think of it as **plug-and-play** instrumentation modules

**3. `aws-otel-js-instrumentation`** ([GitHub](https://github.com/aws-observability/aws-otel-lambda))

- AWS's **official distribution** of OpenTelemetry for Lambda
- Re-packages `opentelemetry-js-contrib` with AWS-specific configurations
- Distributed as a **Lambda Layer** for easy deployment
- ⚠️ **Status**: Still under active development, ESM support incomplete

---

## 2. The Problem: ESM vs CommonJS

### 🔄 Two Module Systems in Node.js

Node.js supports two fundamentally different ways to load modules:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│               CommonJS vs ECMAScript Modules                    │
│                                                                 │
│  ┌──────────────────────┐         ┌──────────────────────┐    │
│  │                      │         │                      │    │
│  │   CommonJS (CJS)     │         │  ECMAScript (ESM)    │    │
│  │   ✅ Works Today     │         │  ❌ Broken Today     │    │
│  │                      │         │                      │    │
│  ├──────────────────────┤         ├──────────────────────┤    │
│  │                      │         │                      │    │
│  │ require() / exports  │         │ import / export      │    │
│  │                      │         │                      │    │
│  │ ✓ Synchronous        │         │ ✓ Asynchronous       │    │
│  │ ✓ Dynamic loading    │         │ ✓ Static analysis    │    │
│  │ ✓ Runtime patching   │         │ ✗ Hard to patch      │    │
│  │   (easy)             │         │   (complex)          │    │
│  │                      │         │                      │    │
│  └──────────────────────┘         └──────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 📝 Code Comparison

**CommonJS (Works with OTEL)**

```javascript
// handler.js
const handler = async (event, context) => {
  return { statusCode: 200, body: 'Hello!' };
};

module.exports = { handler }; // ✅ Exports to module.exports
```

**ESM (Broken with OTEL)**

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

**This is the KEY reason ESM is harder to instrument:**

```
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

**Why This Matters for Instrumentation:**

```javascript
// CommonJS - SYNCHRONOUS (easy to patch)
const instrumentation = new AwsLambdaInstrumentation();
const handlerModule = require('./handler'); // ← Blocks until loaded
// Handler is NOW available - we can patch it!
handlerModule.handler = wrapWithTracing(handlerModule.handler);
```

```javascript
// ESM - ASYNCHRONOUS (hard to patch)
const instrumentation = new AwsLambdaInstrumentation();
const handlerModule = await import('./handler.mjs'); // ← Returns immediately
// But we can't use 'await' in Lambda's initialization!
// And even if we could, ESM exports are IMMUTABLE:
handlerModule.handler = wrapWithTracing(handlerModule.handler); // ❌ Error!
```

**The Import Immutability Problem:**

```javascript
// ESM exports are "live bindings" - they're read-only from the outside!
import { handler } from './handler.mjs';

handler = newFunction; // ❌ TypeError: Assignment to constant variable

// You can only modify exports from INSIDE the module that created them
// This means patching MUST happen before or during module creation
```

### 🔑 The Core Issue: Module Loading Timing

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│         Lambda Runtime Module Loading Sequence                │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  1. Lambda Runtime Starts                            │    │
│  │     /var/runtime/index.mjs                           │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  2. OTEL Instrumentation Loads                       │    │
│  │     (via AWS_LAMBDA_EXEC_WRAPPER)                    │    │
│  │                                                       │    │
│  │     Tries to patch handler... but it's not loaded yet│    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  3. Lambda Runtime Loads Handler                     │    │
│  │     import('/var/task/handler.mjs')                  │    │
│  │                                                       │    │
│  │     ❌ OTEL can't intercept this!                    │    │
│  │     ❌ Handler never appears in module.exports       │    │
│  │     ❌ Handler never appears in globalThis           │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  4. Lambda Invokes Handler                           │    │
│  │     handler(event, context)                          │    │
│  │                                                       │    │
│  │     😢 No instrumentation applied                    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 💡 Why CommonJS Works

**CommonJS Handler Patching Flow:**

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

### ⚠️ Why ESM Fails

**ESM Handler Patching Attempt:**

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

---

## 3. Where the Current Solution Fails

### 📍 Issue Location in Official Package

The official `@opentelemetry/instrumentation-aws-lambda` package has **partial ESM support**:

#### ✅ Part 1: Detection Works ([Source](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/2e639c22e02057daf893c59f3adc954d3c6edea4/packages/instrumentation-aws-lambda/src/instrumentation.ts#L103-L129))

```typescript
// The instrumentation CAN detect if your file is .mjs, .js, or .cjs
private _tryToSetHandlerTimeout(): void {
  const handler = process.env._HANDLER ?? '';
  const fileName = handler.substring(0, handler.lastIndexOf('.'));

  // ✅ This works - detects .mjs files
  if (fs.existsSync(`${taskRoot}/${fileName}.mjs`)) {
    diag.debug('ESM handler detected');
    // ... but then what? 🤔
  }
}
```

#### ❌ Part 2: Patching Fails ([Source](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/2e639c22e02057daf893c59f3adc954d3c6edea4/packages/instrumentation-aws-lambda/src/instrumentation.ts#L146-L176))

```typescript
// Tries to patch the handler, but...
private _loadHandler(): Handler {
  const handler = process.env._HANDLER ?? '';
  const [moduleRoot, handlerName] = handler.split('.');

  // ❌ For ESM files, this doesn't work
  const userHandler = require(moduleRoot)[handlerName];

  // Error: require() of ES Module not supported!
  // The handler is an ES module and can't be loaded with require()
}
```

### 🔍 Visual Breakdown of the Failure

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│        Current OTEL AWS Lambda Instrumentation Flow           │
│                                                                │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 1: Detect Handler File Type             │           │
│  │                                                │           │
│  │  _HANDLER = "handler.handler"                 │           │
│  │  Check for: handler.mjs ✅ Found!             │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 2: Try to Load Handler                  │           │
│  │                                                │           │
│  │  const handler = require('handler').handler   │           │
│  │                                                │           │
│  │  ❌ ERROR: Cannot use require() on ESM!       │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Step 3: Try Alternative: import()            │           │
│  │                                                │           │
│  │  ❌ Problem: import() is asynchronous         │           │
│  │  ❌ Lambda runtime expects sync handler       │           │
│  │  ❌ Timing issues - when to patch?            │           │
│  └────────────┬───────────────────────────────────┘           │
│               │                                               │
│               ▼                                               │
│  ┌────────────────────────────────────────────────┐           │
│  │  Result: Handler Runs Uninstrumented 😢       │           │
│  └────────────────────────────────────────────────┘           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Solution Attempts: What We Tried

We explored **five different approaches** to solve this problem. Here's what we learned:

---

### 🎯 Attempt #1: Manual Instrumentation in Handler

**Approach:** Manually add OpenTelemetry instrumentation code directly in the handler file.

```javascript
// handler.mjs
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

// Set up tracing manually
const provider = new NodeTracerProvider();
provider.register();
registerInstrumentations({ instrumentations: [] });

export const handler = async (event, context) => {
  const tracer = trace.getTracer('my-service');
  const span = tracer.startSpan('handler');

  try {
    // Your handler logic
    return { statusCode: 200, body: 'Hello!' };
  } finally {
    span.end();
  }
};
```

**Result:**

- ✅ **Works!** Traces are generated
- ❌ **Not maintainable** - Must modify every handler
- ❌ **Boilerplate code** in every function
- ❌ **Easy to forget** when creating new functions
- ❌ **Doesn't instrument** AWS SDK or HTTP calls automatically

```
┌────────────────────────────────────────────────────────┐
│  Pros                  │  Cons                         │
├────────────────────────┼───────────────────────────────┤
│  ✓ Works immediately   │  ✗ Code in every handler      │
│  ✓ Full control        │  ✗ Hard to maintain           │
│  ✓ Simple to understand│  ✗ Easy to forget             │
│                        │  ✗ No auto-instrumentation    │
└────────────────────────┴───────────────────────────────┘
```

**Verdict:** ⚠️ **Works but not scalable**

---

### 🎯 Attempt #2: esbuild Banner Injection

**Approach:** Use esbuild's `banner` feature to inject instrumentation code at build time.

#### Configuration

**Step 1: Add Banner to serverless.yml**

```yaml
# serverless.yml
custom:
  esbuild:
    banner:
      js: |
        import { createRequire } from 'module';
        const require = createRequire(import.meta.url);
        import { fileURLToPath as ssb_fileURLToPath } from 'url';
        import { dirname as ssb_dirname } from 'path';

        // Define CommonJS globals for ESM compatibility
        const __filename = ssb_fileURLToPath(import.meta.url);
        const __dirname = ssb_dirname(__filename);

        // Make __dirname and __filename available globally for packages that expect them
        if (typeof globalThis !== 'undefined') {
          globalThis.__dirname = __dirname;
          globalThis.__filename = __filename;
        }

        // ESM Auto-Patch Banner - Provides helper function for manual patching
        // Since ESM exports are immutable, we provide a patcher function you can use
        if (globalThis.__aws_lambda_esm_instrumentation) {
          console.log('🔧 OpenTelemetry instrumentation detected, setting up ESM patching helper...');

          // Create a global patcher function that can be called in your handler file
          globalThis.__patchESMHandler = (handlerFunction, handlerName = 'handler') => {
            if (typeof handlerFunction === 'function') {
              try {
                const patchedHandler = globalThis.__aws_lambda_esm_instrumentation.patchESMHandler(
                  handlerFunction,
                  handlerName
                );
                console.log('✅ ESM handler patched with OpenTelemetry');
                return patchedHandler;
              } catch (error) {
                console.error('❌ Failed to patch ESM handler:', error.message);
                return handlerFunction; // Return original if patching fails
              }
            }
            console.warn('⚠️ Handler is not a function, skipping OpenTelemetry patching');
            return handlerFunction;
          };
        }
```

**What This Banner Does:**

```
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

```
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

**Step 2: Update Your Handler**

The key insight: Since ESM exports are immutable from the outside, we must **patch from the inside** during the export itself.

```javascript
// handler.mjs - New pattern for ESM with OTEL

// Define your handler as a normal async function
async function originalHandler(event, context) {
  // Your business logic here - completely unchanged
  console.log('Processing request:', event);

  const result = await someBusinessLogic(event);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Success',
      result,
    }),
  };
}

// Export the handler (patched if instrumentation is available)
// This is the ONLY change needed - the export line!
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

**What's Happening Here:**

```
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
│  This allows the handler to work:                         │
│  • WITH instrumentation (in AWS Lambda)                   │
│  • WITHOUT instrumentation (local dev)                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Benefits of This Approach:**

1. **Minimal Changes** - Only the export line changes
2. **Safe Fallback** - Works even if instrumentation isn't loaded
3. **Self-Contained** - Each handler patches itself
4. **Type-Safe** - TypeScript still works correctly
5. **Testable** - Can still test the original function directly

**Result:**

- ✅ **Works reliably!** Instrumentation applied to all handlers
- ✅ **Minimal handler changes** - Only the export line
- ✅ **Auto-instruments** AWS SDK and HTTP calls
- ✅ **Safe fallback** - Works without instrumentation (local dev)
- ⚠️ **Requires build configuration** - One-time serverless.yml change
- ⚠️ **Pattern change needed** - Must use the export pattern

```
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

**Real-World Example:**

```javascript
// Before (Original ESM handler)
export const handler = async (event, context) => {
  return { statusCode: 200, body: 'Hello' };
};

// After (With OTEL support)
async function originalHandler(event, context) {
  return { statusCode: 200, body: 'Hello' };
}

export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

**Verdict:** ✅ **Best working solution - Production-ready**

---

### 🎯 Attempt #3: Custom Runtime Patching Instrumentation

**Approach:** Create a custom OpenTelemetry instrumentation package that attempts to patch handlers at runtime using various interception strategies.

#### The Strategy

```
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

#### What We Learned

The Lambda runtime loads ESM handlers in a way that's completely isolated from our instrumentation:

```javascript
// /var/runtime/index.mjs (Lambda's runtime code)
// This is what Lambda actually does:

const handlerModule = await import(`file://var/task/${fileName}.mjs`);
const handler = handlerModule[functionName];

// ❌ This happens AFTER our instrumentation loads
// ❌ It's a direct dynamic import, not going through require()
// ❌ No hooks we can intercept at this level
```

**Result:**

- ❌ **Failed** - Handler never found for patching
- ✅ **Learned a lot** about Node.js module systems
- ✅ **Comprehensive attempt** - tried every possible hook
- ❌ **Root cause**: Lambda runtime bypasses all our hooks

```
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

**Verdict:** ❌ **Failed - Lambda runtime architecture prevents this approach**

---

### 🎯 Attempt #4: Building Official ADOT Lambda Layer

**Approach:** Use AWS's official OpenTelemetry distribution (ADOT) as a Lambda Layer.

#### What is ADOT?

AWS Distro for OpenTelemetry (ADOT) is Amazon's supported distribution of OpenTelemetry, pre-packaged as Lambda Layers.

```
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
  --layers arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-18-1:4

# 2. Set environment variables
export AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
export OPENTELEMETRY_COLLECTOR_CONFIG_FILE=/var/task/collector.yaml
```

**Result:**

- ⚠️ **Inconclusive** - Layer loads but no traces appeared
- ❌ **ESM support unclear** - Documentation doesn't mention .mjs
- ❌ **Black box** - Hard to debug what's happening inside
- ⚠️ **Still in development** - ESM support not officially released

```
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

### 🎯 Attempt #5: ADOT-Inspired Custom Implementation

**Approach:** Reverse-engineer ADOT's structure and use `import-in-the-middle` to intercept ESM imports.

#### The Theory

The ADOT layer uses a library called `import-in-the-middle` which can intercept dynamic `import()` calls:

```
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
// wrapper.mjs
import { addHook } from 'import-in-the-middle';

const functionName = process.env._HANDLER.split('.')[1];

addHook((exports, name, baseDir) => {
  // Check if this module has our handler function
  if (exports && typeof exports[functionName] === 'function') {
    console.log('Found handler! Patching...');

    const originalHandler = exports[functionName];
    const patchedHandler = wrapWithTracing(originalHandler);
    exports[functionName] = patchedHandler;

    console.log('Handler patched successfully!');
  }

  return exports;
});
```

#### The Reality

```
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

- ⚠️ **Partially successful** - Hook sees the handler
- ❌ **Can't patch reliably** - Exports modification doesn't stick
- ✅ **Proved the concept** - Import interception IS possible
- ❌ **Not production-ready** - Too many edge cases

```
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

### 🐳 What is Lambda RIE?

**Lambda Runtime Interface Emulator (RIE)** is a Docker-based tool that emulates the AWS Lambda runtime locally.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              Lambda RIE Architecture                       │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │  Your Local Machine                          │         │
│  │                                              │         │
│  │  ┌────────────────────────────────────┐     │         │
│  │  │  Docker Container                  │     │         │
│  │  │                                    │     │         │
│  │  │  ┌──────────────────────────────┐ │     │         │
│  │  │  │  Lambda RIE                  │ │     │         │
│  │  │  │  (Runtime Emulator)          │ │     │         │
│  │  │  │                              │ │     │         │
│  │  │  │  • Mimics AWS Lambda runtime │ │     │         │
│  │  │  │  • Same environment vars     │ │     │         │
│  │  │  │  • Same handler loading      │ │     │         │
│  │  │  │  • Same constraints          │ │     │         │
│  │  │  └────────────┬─────────────────┘ │     │         │
│  │  │               │                    │     │         │
│  │  │               ▼                    │     │         │
│  │  │  ┌──────────────────────────────┐ │     │         │
│  │  │  │  Your Lambda Function        │ │     │         │
│  │  │  │  • handler.mjs               │ │     │         │
│  │  │  │  • node_modules/             │ │     │         │
│  │  │  │  • OTEL instrumentation      │ │     │         │
│  │  │  └──────────────────────────────┘ │     │         │
│  │  └────────────────────────────────────┘     │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 📁 Our Test Setup

```
test/rie/
├── docker-compose.esm.yml    # Docker Compose for ESM test
├── Dockerfile.esm            # Container definition
├── handler.mjs               # Test ESM handler
├── event.json                # Test event payload
├── package.json              # Dependencies
└── build-esm.sh              # Build script
```

### 🚀 How We Used RIE for Testing

#### 1. Create Test Handler

```javascript
// test/rie/handler.mjs
export const handler = async (event, context) => {
  console.log('[handler.mjs] Function invoked');
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from ESM Lambda!',
      requestId: context.awsRequestId,
      instrumentation: 'Testing',
    }),
  };
};
```

#### 2. Build Docker Image

```dockerfile
# test/rie/Dockerfile.esm
FROM public.ecr.aws/lambda/nodejs:20

# Copy handler
COPY handler.mjs ${LAMBDA_TASK_ROOT}/

# Copy instrumentation
COPY custom-instrumentation/ ${LAMBDA_TASK_ROOT}/instrumentation/

# Install dependencies
WORKDIR ${LAMBDA_TASK_ROOT}
RUN npm install

CMD [ "handler.handler" ]
```

#### 3. Run Tests

```bash
# Start the container
docker compose -f docker-compose.esm.yml up -d

# Invoke the function
curl -X POST http://localhost:9000/2015-03-31/functions/function/invocations \
  -d @event.json

# Check logs
docker compose -f docker-compose.esm.yml logs
```

### 🔍 Why RIE Was Essential

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│         RIE vs Real Lambda: Testing Benefits               │
│                                                            │
│  ┌──────────────────────────┬─────────────────────────┐   │
│  │  With RIE                │  Without RIE (AWS)      │   │
│  ├──────────────────────────┼─────────────────────────┤   │
│  │  ✓ Instant feedback      │  ✗ Slow deploy cycle    │   │
│  │  ✓ Full log access       │  ✗ CloudWatch lag       │   │
│  │  ✓ Easy debugging        │  ✗ Limited visibility   │   │
│  │  ✓ No AWS costs          │  ✗ Costs per invocation │   │
│  │  ✓ Reproducible          │  ✗ Environment drift    │   │
│  │  ✓ Network isolated      │  ✗ Requires AWS creds   │   │
│  └──────────────────────────┴─────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 📊 Test Results from RIE

**Example Test Log Output:**

```
🔧 [INSTRUMENTATION] Setting up automatic handler patching
🔧 [INSTRUMENTATION] Monitoring for handler: handler
[handler.mjs] Loading ESM module
[handler.mjs] ESM module loaded successfully
[handler.mjs] Function invoked
🔄 [INSTRUMENTATION] Monitoring check 20/600 for handler: handler
🔄 [INSTRUMENTATION] Monitoring check 40/600 for handler: handler
...
❌ [INSTRUMENTATION] Could not find handler after 30 seconds
🔍 [INSTRUMENTATION] Available global functions: [Array of 50+ functions]
```

**Key Insight:** RIE showed us that the handler executes successfully BUT never appears in any of the locations we're checking (globalThis, module.exports, require.cache).

---

## 6. Conclusion & Recommendations

### 📊 Summary of All Approaches

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                   Solution Comparison Matrix                        │
│                                                                     │
│  ┌────────────────┬──────┬─────────┬──────────┬──────────────┐    │
│  │ Approach       │Works │Effort   │Maintain  │Recommended   │    │
│  ├────────────────┼──────┼─────────┼──────────┼──────────────┤    │
│  │ 1. Manual      │ ✅   │ Low     │ High     │ ❌ No        │    │
│  │ 2. esbuild     │ ✅   │ Medium  │ Low      │ ✅ YES       │    │
│  │ 3. Custom      │ ❌   │ Very    │ N/A      │ ❌ No        │    │
│  │    Runtime     │      │ High    │          │              │    │
│  │ 4. ADOT Layer  │ ⚠️   │ Low     │ Low      │ ⚠️  Future   │    │
│  │ 5. ADOT-style  │ ⚠️   │ Very    │ High     │ ❌ No        │    │
│  │    Custom      │      │ High    │          │              │    │
│  └────────────────┴──────┴─────────┴──────────┴──────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 🎯 Recommended Approach: esbuild Banner

**For immediate production use, we recommend Approach #2: esbuild Banner Injection**

#### Setup Steps:

**1. Update serverless.yml with Banner:**

```yaml
# serverless.yml
custom:
  esbuild:
    banner:
      js: |
        import { createRequire } from 'module';
        const require = createRequire(import.meta.url);
        import { fileURLToPath as ssb_fileURLToPath } from 'url';
        import { dirname as ssb_dirname } from 'path';

        // Define CommonJS globals for ESM compatibility
        const __filename = ssb_fileURLToPath(import.meta.url);
        const __dirname = ssb_dirname(__filename);

        // Make globals available for packages that expect them
        if (typeof globalThis !== 'undefined') {
          globalThis.__dirname = __dirname;
          globalThis.__filename = __filename;
        }

        // Setup ESM handler patcher (if instrumentation is present)
        if (globalThis.__aws_lambda_esm_instrumentation) {
          globalThis.__patchESMHandler = (handlerFunction, handlerName = 'handler') => {
            if (typeof handlerFunction === 'function') {
              try {
                return globalThis.__aws_lambda_esm_instrumentation.patchESMHandler(
                  handlerFunction,
                  handlerName
                );
              } catch (error) {
                console.error('Failed to patch handler:', error.message);
                return handlerFunction;
              }
            }
            return handlerFunction;
          };
        }
    external:
      - '@opentelemetry/*'
      - '@aws-sdk/*'
```

**2. Update Handler Export Pattern:**

```javascript
// handler.mjs

// Define your handler function (no changes to business logic)
async function originalHandler(event, context) {
  // All your existing code stays exactly the same
  const result = await processEvent(event);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

// Only change: Export with optional patching
export const handler = globalThis.__patchESMHandler
  ? globalThis.__patchESMHandler(originalHandler)
  : originalHandler;
```

**3. Deploy:**

```bash
serverless deploy
```

**Why This Works:**

```
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

   - Monitor: https://github.com/aws-observability/aws-otel-lambda
   - Once stable, switch from banner approach to ADOT layer

2. **OpenTelemetry ESM Native Support** - The OTel community is working on this

   - Track issue: https://github.com/open-telemetry/opentelemetry-js-contrib/issues

3. **Node.js ESM Improvements** - Better hooks for module interception
   - As Node.js matures its ESM support, more solutions may become possible

### 💡 Key Takeaways

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│             What We Learned About ESM + Lambda                 │
│                                                                │
│  1. ESM ≠ CommonJS                                            │
│     Different loading, different timing, different hooks      │
│                                                                │
│  2. Lambda Runtime is Special                                 │
│     It loads modules in a way that bypasses normal hooks      │
│                                                                │
│  3. Build-Time > Run-Time                                     │
│     For ESM, build-time injection is more reliable            │
│                                                                │
│  4. ADOT is the Future                                        │
│     Once ESM support is complete, it will be the best option  │
│                                                                │
│  5. RIE is Essential                                          │
│     Local testing saved us countless hours and $$$            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 📚 Additional Resources

- [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js)
- [OpenTelemetry JS Contrib](https://github.com/open-telemetry/opentelemetry-js-contrib)
- [AWS ADOT Lambda](https://github.com/aws-observability/aws-otel-lambda)
- [Lambda RIE](https://docs.aws.amazon.com/lambda/latest/dg/images-test.html)
- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [import-in-the-middle](https://github.com/DataDog/import-in-the-middle)

---

## 📝 Document Version

- **Version**: 1.0.0
- **Last Updated**: October 2025
- **Author**: Emmanuel Adu
- **Status**: Comprehensive Analysis Complete

---

_This document represents months of investigation, experimentation, and learning. We hope it helps your journey with ESM and OpenTelemetry!_ 🚀
