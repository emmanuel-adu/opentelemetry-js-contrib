# ESM Lambda Instrumentation: Solutions Comparison

This document compares three approaches for adding OpenTelemetry instrumentation to ESM Lambda handlers.

## 🎯 **Option 1: CJS Shim Wrapper (RECOMMENDED)**

### **✅ ZERO Handler Modifications Required!**

Your ESM handlers remain completely untouched. A CommonJS shim wrapper dynamically imports and patches them.

### How It Works

```sh
┌─────────────────────────────────────────┐
│ Lambda Invocation                       │
│  handler: shim/wrapper.handler          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ CJS Shim Wrapper (wrapper.cjs)         │
│  1. Dynamically imports your ESM        │
│  2. Patches it with OpenTelemetry       │
│  3. Returns patched version             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Your Pure ESM Handler (lambda.mjs)     │
│  export async function handler(...) {  │
│    // NO MODIFICATIONS NEEDED!         │
│  }                                      │
└─────────────────────────────────────────┘
```

1. **Your handler stays pure ESM:**

   ```typescript
   // lambda.mjs - NO CHANGES NEEDED!
   export async function handler(event, context) {
     // Your code here
     return { statusCode: 200, body: 'Hello' };
   }
   ```

2. **Point Lambda to the shim wrapper:**

   ```yaml
   functions:
     myFunction:
       handler: shim/wrapper.handler # ← Points to shim
       environment:
         ACTUAL_HANDLER: lambda.handler # ← Your real handler
   ```

3. **The shim handles everything:**
   - Dynamically imports your ESM handler
   - Patches it with OpenTelemetry
   - Exports the patched version

### Configuration

```yaml
# serverless.yml
custom:
  esbuild:
    format: 'esm'
    # No banner needed!

functions:
  myFunction:
    handler: shim/wrapper.handler
    environment:
      ACTUAL_HANDLER: lambda.handler

package:
  patterns:
    - 'shim/wrapper.cjs' # Include the shim
    - 'lambda.mjs' # Your handler
```

### Pros

✅ **Zero handler modifications** - handlers stay 100% pure
✅ **Works with any ESM handler** - no code changes needed
✅ **Automatic patching** - shim handles everything
✅ **Easy to enable/disable** - just change handler path
✅ **Graceful fallback** - works even without OTel
✅ **Type-safe** - no impact on TypeScript

### Cons

⚠️ **Extra environment variable** - need to set `ACTUAL_HANDLER`
⚠️ **One extra file** - need to include shim in deployment
⚠️ **Minimal overhead** - one additional function call (negligible)

### Test Results

```sh
✅ [CJS Shim] Successfully patched handler: handler-pure-esm.handler
✅ [REQUEST HOOK] Span created
✅ [RESPONSE HOOK] Span ending
```

**Status:** ✅ **VALIDATED in Lambda RIE**

---

## 🔧 **Option 2: Banner with `__patchESMHandler` Helper**

### **3 Lines of Code per Handler**

Requires adding a simple export pattern to the end of each handler file.

### How It Works

1. **Add banner to esbuild** (defines `__patchESMHandler` globally):

   ```yaml
   custom:
     esbuild:
       banner:
         js: |
           globalThis.__patchESMHandler = (handlerFunction) => {
             // Patching logic here
           };
   ```

2. **Update your handlers** (add 3 lines):

   ```typescript
   // Your handler logic
   async function originalHandler(event, context) {
     return { statusCode: 200, body: 'Hello' };
   }

   // Add these 3 lines:
   export const handler = globalThis.__patchESMHandler
     ? globalThis.__patchESMHandler(originalHandler)
     : originalHandler;
   ```

### Pros

✅ **Minimal handler changes** - only 3 lines
✅ **No extra files** - just banner configuration
✅ **Explicit patching** - clear what's happening
✅ **Graceful fallback** - ternary handles missing OTel

### Cons

⚠️ **Requires handler modifications** - every handler needs updating
⚠️ **Manual updates** - need to remember for new handlers
⚠️ **Pattern enforcement** - team must follow convention

### Test Results

```
✅ ESM handler patched with OpenTelemetry
✅ [REQUEST HOOK] Span created
✅ [RESPONSE HOOK] Span ending
```

**Status:** ✅ **VALIDATED in Lambda RIE**

---

## 📦 **Option 3: Standard OpenTelemetry (CommonJS Only)**

### **Only Works with CommonJS**

The standard OpenTelemetry instrumentation works automatically for CommonJS modules but fails for ESM because Node.js `import()` bypasses the CommonJS hooks.

### How It Works

1. **Handler in CommonJS:**

   ```javascript
   // lambda.js (CommonJS)
   exports.handler = async (event, context) => {
     return { statusCode: 200, body: 'Hello' };
   };
   ```

2. **Standard initialization:**
   ```javascript
   const {
     AwsLambdaInstrumentation,
   } = require('@opentelemetry/instrumentation-aws-lambda');
   const instrumentation = new AwsLambdaInstrumentation();
   // No additional setup needed!
   ```

### Pros

✅ **Zero configuration** - works out of the box
✅ **Official OpenTelemetry** - standard approach
✅ **Automatic patching** - no handler changes

### Cons

❌ **CommonJS only** - doesn't work with ESM (`.mjs`, `"type": "module"`)
❌ **Not future-proof** - ESM is the modern standard

**Status:** ✅ **Works for CommonJS**, ❌ **Fails for ESM**

---

## 📊 **Comparison Matrix**

| Feature                   | CJS Shim   | Banner Helper | Standard CJS |
| ------------------------- | ---------- | ------------- | ------------ |
| **Handler Modifications** | ✅ None    | ⚠️ 3 lines    | ✅ None      |
| **Works with ESM**        | ✅ Yes     | ✅ Yes        | ❌ No        |
| **Setup Complexity**      | ⚠️ Medium  | ⚠️ Medium     | ✅ Low       |
| **Runtime Overhead**      | ⚠️ Minimal | ✅ None       | ✅ None      |
| **Maintainability**       | ✅ High    | ⚠️ Medium     | ✅ High      |
| **Future-proof**          | ✅ Yes     | ✅ Yes        | ❌ No        |
| **RIE Validated**         | ✅ Yes     | ✅ Yes        | ✅ Yes       |

---

## 🎯 **Recommendation**

### **For New Projects or Large Codebases:**

→ **Use Option 1: CJS Shim Wrapper**

- Zero handler modifications
- Easiest to scale across many handlers
- Minimal maintenance overhead

### **For Small Projects or Tight Control:**

→ **Use Option 2: Banner Helper**

- Explicit and visible in code
- Minimal overhead
- Clear what's happening

### **For CommonJS Projects:**

→ **Use Option 3: Standard OpenTelemetry**

- Works out of the box
- No additional setup needed

---

## 🚀 **Getting Started**

### Option 1: CJS Shim (Recommended)

1. **Copy the shim wrapper** to your project:

   - See `examples/esm-shim-wrapper.cjs`

2. **Update serverless.yml:**

   ```yaml
   functions:
     myFunction:
       handler: shim/wrapper.handler
       environment:
         ACTUAL_HANDLER: lambda.handler
   ```

3. **Keep your handlers unchanged!** ✨

### Option 2: Banner Helper

1. **Add banner to serverless.yml:**

   - See `examples/complete-serverless-solution.yml`

2. **Update each handler:**
   ```typescript
   export const handler = globalThis.__patchESMHandler
     ? globalThis.__patchESMHandler(originalHandler)
     : originalHandler;
   ```

---

## 📝 **Examples**

- **CJS Shim:** `examples/esm-shim-wrapper.cjs`
- **Serverless Config:** `examples/serverless-with-shim.yml`
- **Banner Config:** `examples/complete-serverless-solution.yml`
- **RIE Tests:** `test-lambda-rie/`

---

## ✅ **Validation**

All solutions have been tested in:

- ✅ Lambda Runtime Interface Emulator (RIE)
- ✅ Production-like Docker environment
- ✅ With OpenTelemetry SDK
- ✅ REQUEST/RESPONSE hooks working
- ✅ Span creation confirmed

Both ESM solutions provide **100% feature parity** with the CommonJS approach.
