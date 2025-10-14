# AWS Lambda ESM Instrumentation Examples

This directory contains examples and solutions for OpenTelemetry instrumentation with ESM Lambda handlers.

## 🎯 **Recommended Solution: Custom Instrumentation**

The **custom instrumentation** approach is the best solution for ESM + `serverless-esbuild` compatibility:

### **Files:**

- `custom-aws-lambda-instrumentation.ts` - Production-ready custom instrumentation
- `custom-instrumentation-usage.ts` - Usage examples
- `CUSTOM_INSTRUMENTATION_GUIDE.md` - Complete setup guide

### **Benefits:**

- ✅ **Zero handler changes** - Your existing code stays exactly the same
- ✅ **Works with `serverless-esbuild`** - No compilation conflicts
- ✅ **ESM compatible** - Works with modern ES modules
- ✅ **Drop-in replacement** - Works exactly like official OpenTelemetry instrumentations
- ✅ **Automatic patching** - Handlers are instrumented automatically

## 🔧 **Alternative Solutions**

### **CJS Shim Approach**

- `esm-shim-wrapper.cjs` - CommonJS shim for ESM handlers
- `serverless-with-shim.yml` - Serverless configuration example

### **Banner Approach**

- `complete-serverless-solution.yml` - Banner-based auto-patching
- `BANNER_FIX.md` - Banner troubleshooting guide

## 📊 **Comparison**

See `CJS_vs_ESM_COMPARISON.md` for detailed comparison of all approaches.

## 🚀 **Quick Start**

1. **Copy the custom instrumentation:**

   ```bash
   cp custom-aws-lambda-instrumentation.ts ./src/
   ```

2. **Add to your NodeSDK:**

   ```typescript
   import { CustomAwsLambdaInstrumentation } from './custom-aws-lambda-instrumentation';

   const sdk = new NodeSDK({
     instrumentations: [new CustomAwsLambdaInstrumentation()],
   });
   ```

3. **Keep your handlers unchanged** - No code modifications needed!

For complete setup instructions, see `CUSTOM_INSTRUMENTATION_GUIDE.md`.
