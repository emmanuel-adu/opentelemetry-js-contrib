# Production Patterns Applied

This document outlines the official OpenTelemetry patterns applied to the custom AWS Lambda instrumentation to ensure production-ready quality.

## ✅ Official Patterns Implemented

### 1. **Lambda Start Time Calculation**

```typescript
// Calculate lambda start time in constructor - matches official pattern
this._lambdaStartTime =
  config.lambdaStartTime || Date.now() - Math.floor(1000 * process.uptime());
```

**Why**: This accurately determines cold starts by calculating when the Lambda container started, not when the handler was called.

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:180-182`

---

### 2. **Handler Definition Resolution**

```typescript
// Set in init() when environment is ready - matches official pattern
this._handlerDef = this.getConfig().lambdaHandler ?? process.env._HANDLER;
```

**Why**:

- `init()` is called when SDK starts, ensuring environment is ready
- `getConfig()` gets current config, supporting dynamic updates
- Fallback to `process.env._HANDLER` for standard Lambda environments

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:114-115`

---

### 3. **Early Exit Guard**

```typescript
if (!this._handlerDef) {
  this._diag.debug(
    'Skipping lambda instrumentation: no _HANDLER/lambdaHandler.',
    { handlerDef: this._handlerDef }
  );
  return [];
}
```

**Why**: Gracefully skip instrumentation if not in Lambda environment, with debug logging for troubleshooting.

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:117-124`

---

### 4. **Consistent Diagnostic Logging**

```typescript
// Use this._diag instead of diag for scoped logging
this._diag.debug('Patched Lambda handler', { handlerName });
```

**Why**:

- `this._diag` is scoped to the instrumentation instance
- Allows filtering and configuration per instrumentation
- Consistent with OpenTelemetry patterns

**Source**: Throughout official instrumentation

---

### 5. **Force Flusher Pattern**

```typescript
private declare _traceForceFlusher?: () => Promise<void>;
private declare _metricForceFlusher?: () => Promise<void>;
```

**Why**:

- Uses TypeScript's `declare` for optional properties
- Matches official instrumentation structure
- Ensures traces/metrics are exported before Lambda freezes

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:105-106`

---

### 6. **Handler Registry Pattern**

```typescript
private _originalHandlers = new Map<string, any>();
```

**Why**:

- Prevents double-patching of handlers
- Stores original handlers for potential unwrapping
- Efficient lookup using Map

**Source**: Similar to `_manualPatchRegistry` in official instrumentation

---

### 7. **Cold Start Detection Constants**

```typescript
export const lambdaMaxInitInMilliseconds = 10_000;
```

**Why**:

- Exported constant for proactive initialization detection
- 10 seconds threshold matches AWS behavior
- Used to distinguish cold starts from proactive initialization

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:77`

---

### 8. **Streaming Handler Support**

```typescript
export const AWS_HANDLER_STREAMING_SYMBOL = Symbol.for(
  'aws.lambda.runtime.handler.streaming'
);
export const AWS_HANDLER_STREAMING_RESPONSE = 'response';
```

**Why**:

- Supports Lambda Response Streaming (Node.js 18+)
- Uses well-known symbols for handler type detection
- Future-proof for Lambda streaming features

**Source**: `packages/instrumentation-aws-lambda/src/instrumentation.ts:78-81`

---

### 9. **Configuration Interface**

```typescript
interface AwsLambdaInstrumentationConfig {
  lambdaHandler?: string;
  lambdaStartTime?: number;
  requestHook?: (span: Span, info: { event: any; context: Context }) => void;
  responseHook?: (
    span: Span,
    info: { err?: Error | string | null; res?: any }
  ) => void;
  eventContextExtractor?: EventContextExtractor;
  enabled?: boolean;
  version?: string;
}
```

**Why**:

- Matches official config structure
- Supports testing via `lambdaStartTime` override
- Extensible with hooks and custom extractors

**Source**: `packages/instrumentation-aws-lambda/src/types.ts`

---

### 10. **Class Documentation**

```typescript
/**
 * Custom AWS Lambda instrumentation that supports ESM modules with serverless-esbuild.
 *
 * Unlike the official AwsLambdaInstrumentation which uses InstrumentationNodeModuleDefinition
 * (CommonJS require() hooks), this implementation uses runtime patching to support ESM modules.
 */
```

**Why**:

- Clear explanation of purpose and differences
- Helps users understand when to use this vs official instrumentation
- Documents key features and trade-offs

---

## 🎯 Key Differences from Official Instrumentation

| Aspect              | Official                                          | Custom                                |
| ------------------- | ------------------------------------------------- | ------------------------------------- |
| **Module Loading**  | `InstrumentationNodeModuleDefinition` (CJS hooks) | Runtime interception (ESM compatible) |
| **File System**     | Resolves handler files with `fs.statSync`         | Uses `process.env._HANDLER` only      |
| **Patching Method** | Module loader hooks                               | `Object.defineProperty` + `Proxy`     |
| **ESM Support**     | Limited (requires module loader hooks)            | Full (runtime patching)               |
| **Build Tools**     | Works with standard builds                        | Optimized for `serverless-esbuild`    |

---

## 📊 Production Readiness Checklist

- ✅ Lambda start time calculation (cold start detection)
- ✅ Handler definition from `process.env._HANDLER`
- ✅ Early exit guards with diagnostic logging
- ✅ Force flusher for traces and metrics
- ✅ Handler registry to prevent double-patching
- ✅ Streaming handler support
- ✅ Configuration interface with hooks
- ✅ Comprehensive error handling
- ✅ TypeScript type safety
- ✅ Documentation and examples

---

## 🚀 Usage

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { CustomAwsLambdaInstrumentation } from './custom-aws-lambda-instrumentation';

const sdk = new NodeSDK({
  instrumentations: [
    new CustomAwsLambdaInstrumentation({
      // All official config options supported
      requestHook: (span, { event, context }) => {
        span.setAttributes({ ... });
      },
    }),
  ],
});
```

This custom instrumentation follows OpenTelemetry's official patterns while adapting them for ESM and `serverless-esbuild` compatibility.
