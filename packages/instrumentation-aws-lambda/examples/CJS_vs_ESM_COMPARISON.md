# CommonJS vs ESM Instrumentation Comparison

## Summary: ✅ **100% Feature Parity**

The banner-based ESM patching provides **identical functionality** to automatic CJS instrumentation. Both use the exact same `_getHandler()` and `_getPatchHandler()` methods.

## Detailed Comparison

### 1. **Handler Wrapping Logic**

#### CommonJS (Automatic)

```typescript
// instrumentation.ts lines 196-265
this._wrap(actualExports, functionName, this._getHandler(lambdaStartTime));
```

#### ESM (Banner-based Manual)

```typescript
// instrumentation.ts lines 754-774
const wrappedHandler = this._getHandler(lambdaStartTime)(handler);
```

**Result**: ✅ **IDENTICAL** - Both call `this._getHandler()` with the same parameters.

---

### 2. **Span Creation & Attributes**

Both approaches use `_createSpanForRequest()` which creates spans with:

- ✅ `ATTR_FAAS_EXECUTION`: AWS Request ID
- ✅ `ATTR_FAAS_ID`: Function ARN
- ✅ `ATTR_CLOUD_ACCOUNT_ID`: AWS Account ID
- ✅ `ATTR_FAAS_COLDSTART`: Cold start detection
- ✅ Additional event fields (URL, HTTP method, etc.)

**Result**: ✅ **IDENTICAL**

---

### 3. **Cold Start Detection**

Both approaches use the same `_onRequest()` logic in `_getPatchHandler()`:

- ✅ Tracks `requestHandledBefore`
- ✅ Checks `AWS_LAMBDA_INITIALIZATION_TYPE` for provisioned concurrency
- ✅ Detects proactive initialization (10+ seconds since handler load)
- ✅ Sets `requestIsColdStart` correctly

**Result**: ✅ **IDENTICAL**

---

### 4. **Request Hook**

Both approaches call `_applyRequestHook()`:

```typescript
// instrumentation.ts line 409
plugin._applyRequestHook(span, event, context);
```

**Result**: ✅ **IDENTICAL**

---

### 5. **Response Hook**

Both approaches call `_applyResponseHook()`:

```typescript
// instrumentation.ts lines 430, 490, 504
plugin._applyResponseHook(span, error);
plugin._applyResponseHook(span, error, res);
```

**Result**: ✅ **IDENTICAL**

---

### 6. **Context Propagation**

Both approaches use the same context propagation:

```typescript
// instrumentation.ts line 411
return otelContext.with(trace.setSpan(parent, span), () => {
  // handler execution
});
```

**Result**: ✅ **IDENTICAL**

---

### 7. **Parent Span Determination**

Both use `_determineParent()` which extracts context from:

- ✅ AWS API Gateway headers
- ✅ Custom event context extractors
- ✅ W3C Trace Context propagation

**Result**: ✅ **IDENTICAL**

---

### 8. **Promise & Callback Support**

Both approaches wrap callbacks and handle promises:

```typescript
// instrumentation.ts lines 418-436
const wrappedCallback = plugin._wrapCallback(
  callback,
  span,
  () => (spanEnded = true)
);
const maybePromise = safeExecuteInTheMiddle(
  () => original.apply(this, [event, context, wrappedCallback]),
  error => {
    /* error handling */
  }
);
return plugin._handlePromiseResult(span, maybePromise, () => spanEnded);
```

**Result**: ✅ **IDENTICAL**

---

### 9. **Streaming Handler Support**

Both approaches detect and handle streaming handlers:

```typescript
// instrumentation.ts lines 295-302, 346-380
if (this._isStreamingHandler(original)) {
  // Copy streaming symbols
  // Use special patchedStreamingHandler
}
```

**Result**: ✅ **IDENTICAL**

---

### 10. **Error Handling**

Both approaches use the same error handling:

- ✅ `safeExecuteInTheMiddle()` catches synchronous errors
- ✅ Promise rejection handling
- ✅ Callback error handling
- ✅ Span status set to ERROR on exceptions

**Result**: ✅ **IDENTICAL**

---

### 11. **Span Lifecycle Management**

Both approaches use the same span ending logic:

- ✅ `spanEnded` flag prevents double-ending
- ✅ `_endSpan()` with proper cleanup
- ✅ Force flush for trace and metric providers

**Result**: ✅ **IDENTICAL**

---

## Code Path Comparison

### CommonJS Auto-Patching Path

```
1. Node.js loads handler via require()
2. OpenTelemetry intercepts via InstrumentationNodeModuleFile
3. Calls _patchModuleExports()
4. Calls this._getHandler(lambdaStartTime)(originalHandler)
5. Returns wrapped handler
```

### ESM Banner-Based Path

```
1. Node.js loads handler via import()
2. Banner code executes after handler definition
3. Calls instrumentation.patchESMHandler(originalHandler)
4. Calls this._getHandler(lambdaStartTime)(originalHandler)
5. Returns wrapped handler
```

**Key Point**: Both end up calling `this._getHandler(lambdaStartTime)(originalHandler)`, which is the exact same wrapping function!

---

## What You Get with Both Approaches

### ✅ Full OpenTelemetry Instrumentation:

1. **Automatic Span Creation**: Spans created for every Lambda invocation
2. **Request Hook**: Custom span attributes before handler execution
3. **Response Hook**: Custom span attributes after handler execution
4. **Cold Start Detection**: Accurate cold start tracking
5. **Context Propagation**: W3C Trace Context and AWS-specific propagation
6. **Error Tracking**: Automatic error capture and span status updates
7. **Promise Support**: Works with async/await handlers
8. **Callback Support**: Works with callback-based handlers
9. **Streaming Support**: Works with Lambda response streaming
10. **Force Flush**: Ensures traces/metrics export before Lambda freezes

---

## Differences (Minimal)

| Feature             | CommonJS                       | ESM (Banner)                | Impact                              |
| ------------------- | ------------------------------ | --------------------------- | ----------------------------------- |
| **Patching Method** | Automatic via `require()` hook | Manual via banner           | None - same wrapper used            |
| **Timing**          | During module load             | After handler definition    | None - both before first invocation |
| **Code Visibility** | Hidden in instrumentation      | Visible in banner           | Better debugging for ESM            |
| **Registry**        | Uses unwrap mechanism          | Uses `_manualPatchRegistry` | None - both support unwrapping      |

---

## Conclusion

### ✅ **The banner-based ESM patching is 100% functionally equivalent to automatic CJS instrumentation.**

**Both approaches:**

- Use the exact same `_getHandler()` method
- Create spans with identical attributes
- Support request/response hooks
- Handle promises and callbacks
- Detect cold starts correctly
- Propagate context properly
- Handle errors identically
- Support streaming handlers

**The only difference is HOW the handler gets wrapped:**

- **CJS**: Via OpenTelemetry's `require()` interception
- **ESM**: Via banner code calling `patchESMHandler()`

**Both end up calling the exact same wrapping logic, so you get 100% of the functionality!**
