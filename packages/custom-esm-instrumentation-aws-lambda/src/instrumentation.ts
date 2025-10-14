/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  InstrumentationBase,
  safeExecuteInTheMiddle,
} from '@opentelemetry/instrumentation';
import {
  Context as OtelContext,
  context as otelContext,
  trace,
  propagation,
  MeterProvider,
  Span,
  SpanKind,
  SpanStatusCode,
  TextMapGetter,
  TracerProvider,
  ROOT_CONTEXT,
  Attributes,
} from '@opentelemetry/api';
import { ATTR_URL_FULL } from '@opentelemetry/semantic-conventions';

import {
  APIGatewayProxyEventHeaders,
  Callback,
  Context,
  Handler,
  StreamifyHandler,
} from 'aws-lambda';

import type { AwsLambdaInstrumentationConfig } from './types';

// Lambda-specific semantic conventions
const ATTR_FAAS_EXECUTION = 'faas.execution';
const ATTR_FAAS_ID = 'faas.id';
const ATTR_CLOUD_ACCOUNT_ID = 'cloud.account.id';
const ATTR_FAAS_COLDSTART = 'faas.coldstart';

// Package info (inline to avoid import issues)
const PACKAGE_NAME = 'custom-aws-lambda-instrumentation';
const PACKAGE_VERSION = '1.0.0';

const headerGetter: TextMapGetter<APIGatewayProxyEventHeaders> = {
  keys(carrier): string[] {
    return Object.keys(carrier);
  },
  get(carrier, key: string) {
    return carrier[key];
  },
};

export const lambdaMaxInitInMilliseconds = 10_000;
export const AWS_HANDLER_STREAMING_SYMBOL = Symbol.for(
  'aws.lambda.runtime.handler.streaming'
);
export const AWS_HANDLER_STREAMING_RESPONSE = 'response';

/**
 * Custom AWS Lambda instrumentation that supports ESM modules with serverless-esbuild.
 *
 * Unlike the official AwsLambdaInstrumentation which uses InstrumentationNodeModuleDefinition
 * (CommonJS require() hooks), this implementation uses runtime patching to support ESM modules.
 *
 * Key features:
 * - Automatic handler detection using process.env._HANDLER
 * - Runtime interception of handler exports
 * - Full OpenTelemetry tracing and metrics support
 * - Cold start detection
 * - ESM and CommonJS compatibility
 */
export class CustomAwsLambdaInstrumentation extends InstrumentationBase<AwsLambdaInstrumentationConfig> {
  private declare _traceForceFlusher?: () => Promise<void>;
  private declare _metricForceFlusher?: () => Promise<void>;
  private _originalHandlers = new Map<string, any>();
  private _isInstrumented = false;
  private _handlerDef: string | undefined;
  private _lambdaStartTime: number;

  constructor(config: AwsLambdaInstrumentationConfig = {}) {
    const version = config.version || PACKAGE_VERSION;
    super(PACKAGE_NAME, version, config);

    // Calculate lambda start time - same pattern as official instrumentation
    // Allow override via config for testing purposes
    this._lambdaStartTime =
      config.lambdaStartTime ||
      Date.now() - Math.floor(1000 * process.uptime());
  }

  init() {
    // Set handler definition at init time when environment is ready
    this._handlerDef = this.getConfig().lambdaHandler ?? process.env._HANDLER;

    if (!this._handlerDef) {
      this._diag.debug(
        'Skipping lambda instrumentation: no _HANDLER/lambdaHandler.',
        { handlerDef: this._handlerDef }
      );
      return [];
    }

    // Set up automatic handler patching for ESM modules
    // This approach works with ESM because it doesn't rely on CommonJS require() hooks
    this._setupAutomaticHandlerPatching();

    // Return empty array since we're not using InstrumentationNodeModuleDefinition
    // which doesn't work with ESM import() calls
    return [];
  }

  /**
   * Sets up automatic patching of Lambda handlers for ESM modules
   */
  private _setupAutomaticHandlerPatching(): void {
    if (this._isInstrumented) return;

    // Patch handlers immediately - no setTimeout needed
    // The instrumentation is loaded before user code, so this is safe
    this._patchSpecificHandler();
    this._setupHandlerInterceptor();

    this._isInstrumented = true;
  }

  /**
   * Patch the specific handler defined in process.env._HANDLER
   */
  private _patchSpecificHandler(): void {
    const functionName = this._getHandlerFunctionName();
    if (!functionName) return;

    this._diag.debug('Attempting to patch specific handler', { functionName });

    // Try to patch the specific handler function
    // This will work if the handler is already loaded in global scope or module.exports
    if (typeof (globalThis as any)[functionName] === 'function') {
      this._patchHandler((globalThis as any)[functionName], functionName);
      this._diag.debug('Patched handler in global scope', { functionName });
    } else if (
      typeof module !== 'undefined' &&
      module.exports &&
      typeof module.exports[functionName] === 'function'
    ) {
      this._patchHandler(module.exports[functionName], functionName);
      this._diag.debug('Patched handler in module.exports', { functionName });
    } else {
      this._diag.debug('Handler not found yet, will be patched when it loads', {
        functionName,
      });
    }
  }

  /**
   * Set up interception for new handler exports
   */
  private _setupHandlerInterceptor(): void {
    const functionName = this._getHandlerFunctionName();
    if (!functionName) return;

    // Track whether we've successfully patched the handler
    let handlerPatched = false;

    // Intercept global handler assignments - only for the specific handler function
    const originalDefineProperty = Object.defineProperty;
    (Object.defineProperty as any) = <T>(
      target: T,
      property: PropertyKey,
      descriptor: PropertyDescriptor
    ): T => {
      // Only intercept if we haven't patched yet
      if (
        !handlerPatched &&
        typeof descriptor.value === 'function' &&
        String(property) === functionName &&
        this._isHandlerFunction(descriptor.value)
      ) {
        descriptor.value = this._patchHandler(
          descriptor.value,
          String(property)
        );
        handlerPatched = true;

        // Restore original Object.defineProperty after successful patch
        Object.defineProperty = originalDefineProperty;
        this._diag.debug(
          'Handler patched successfully, restored Object.defineProperty'
        );
      }
      return originalDefineProperty.call(
        this,
        target,
        property,
        descriptor
      ) as T;
    };

    // Intercept module.exports assignments (CommonJS) - only for the specific handler function
    if (typeof module !== 'undefined' && module.exports) {
      const originalExports = { ...module.exports };

      module.exports = new Proxy(originalExports, {
        set: (target, property, value) => {
          // Only intercept if we haven't patched yet
          if (
            !handlerPatched &&
            typeof value === 'function' &&
            String(property) === functionName &&
            this._isHandlerFunction(value)
          ) {
            value = this._patchHandler(value, String(property));
            handlerPatched = true;

            // Restore original Object.defineProperty after successful patch
            Object.defineProperty = originalDefineProperty;
            this._diag.debug(
              'Handler patched successfully via module.exports, restored Object.defineProperty'
            );
          }
          target[property] = value;
          return true;
        },
      });
    }
  }

  /**
   * Get the handler function name from the handler definition
   */
  private _getHandlerFunctionName(): string | null {
    if (!this._handlerDef) {
      this._diag.debug(
        'No handler definition found, skipping specific handler patching'
      );
      return null;
    }

    // Parse handler definition (e.g., "lambda.handler" -> ["lambda", "handler"])
    const [moduleName, functionName] = this._handlerDef.split('.', 2);

    if (!moduleName || !functionName) {
      this._diag.warn('Invalid handler format, expected "module.function"', {
        handlerDef: this._handlerDef,
      });
      return null;
    }

    return functionName;
  }

  /**
   * Check if a function looks like a Lambda handler
   */
  private _isHandlerFunction(fn: Function): boolean {
    // Check function signature - Lambda handlers typically have 2-3 parameters
    const paramCount = fn.length;
    if (paramCount < 2 || paramCount > 3) return false;

    // Check if it's already been patched
    if (this._originalHandlers.has(fn.name)) return false;

    // Check if it's in a Lambda environment
    return !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env._HANDLER);
  }

  /**
   * Patch a handler function with OpenTelemetry instrumentation
   */
  private _patchHandler(originalHandler: any, handlerName: string): any {
    if (this._originalHandlers.has(handlerName)) {
      return originalHandler; // Already patched
    }

    // Store original handler
    this._originalHandlers.set(handlerName, originalHandler);

    // Use the production handler wrapping logic with the lambda start time
    const instrumentedHandler = this._getPatchHandler(
      originalHandler,
      this._lambdaStartTime
    );

    // For streaming handlers, copy special symbols to the patched handler
    if (this._isStreamingHandler(originalHandler)) {
      for (const symbol of Object.getOwnPropertySymbols(originalHandler)) {
        (instrumentedHandler as unknown as Record<symbol, unknown>)[symbol] = (
          originalHandler as unknown as Record<symbol, unknown>
        )[symbol];
      }
    }

    // Replace the handler
    if (typeof (globalThis as any)[handlerName] !== 'undefined') {
      (globalThis as any)[handlerName] = instrumentedHandler;
    }

    if (typeof module !== 'undefined' && module.exports) {
      (module.exports as any)[handlerName] = instrumentedHandler;
    }

    this._diag.debug('Patched Lambda handler', { handlerName });
    return instrumentedHandler;
  }

  private _getPatchHandler(
    original: Handler | StreamifyHandler,
    lambdaStartTime: number
  ): Handler | StreamifyHandler {
    this._diag.debug('patch handler function');
    const plugin = this;

    let requestHandledBefore = false;
    let requestIsColdStart = true;

    function _onRequest(): void {
      if (requestHandledBefore) {
        // Non-first requests cannot be coldstart.
        requestIsColdStart = false;
      } else {
        if (
          process.env.AWS_LAMBDA_INITIALIZATION_TYPE ===
          'provisioned-concurrency'
        ) {
          // If sandbox environment is initialized with provisioned concurrency,
          // even the first requests should not be considered as coldstart.
          requestIsColdStart = false;
        } else {
          // Check whether it is proactive initialization or not:
          // https://aaronstuyvenberg.com/posts/understanding-proactive-initialization
          const passedTimeSinceHandlerLoad: number =
            Date.now() - lambdaStartTime;
          const proactiveInitialization: boolean =
            passedTimeSinceHandlerLoad > lambdaMaxInitInMilliseconds;

          // If sandbox has been initialized proactively before the actual request,
          // even the first requests should not be considered as coldstart.
          requestIsColdStart = !proactiveInitialization;
        }
        requestHandledBefore = true;
      }
    }

    if (this._isStreamingHandler(original)) {
      return function patchedStreamingHandler(
        this: never,
        // The event can be a user type, it truly is any.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: any,
        responseStream: Parameters<StreamifyHandler>[1],
        context: Context
      ) {
        _onRequest();

        const parent = plugin._determineParent(event, context);
        const span = plugin._createSpanForRequest(
          event,
          context,
          requestIsColdStart,
          parent
        );
        plugin._applyRequestHook(span, event, context);

        return otelContext.with(trace.setSpan(parent, span), () => {
          const maybePromise = safeExecuteInTheMiddle(
            () => original.apply(this, [event, responseStream, context]),
            error => {
              if (error != null) {
                // Exception thrown synchronously before resolving promise.
                plugin._applyResponseHook(span, error);
                plugin._endSpan(span, error, () => {});
              }
            }
          ) as Promise<{}> | undefined;

          return plugin._handlePromiseResult(span, maybePromise);
        });
      };
    }

    return function patchedHandler(
      this: never,
      // The event can be a user type, it truly is any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: any,
      context: Context,
      callback: Callback
    ) {
      _onRequest();

      const parent = plugin._determineParent(event, context);

      const span = plugin._createSpanForRequest(
        event,
        context,
        requestIsColdStart,
        parent
      );

      plugin._applyRequestHook(span, event, context);

      return otelContext.with(trace.setSpan(parent, span), () => {
        // Lambda seems to pass a callback even if handler is of Promise form, so we wrap all the time before calling
        // the handler and see if the result is a Promise or not. In such a case, the callback is usually ignored. If
        // the handler happened to both call the callback and complete a returned Promise, whichever happens first will
        // win and the latter will be ignored.
        const wrappedCallback = plugin._wrapCallback(callback, span);
        const maybePromise = safeExecuteInTheMiddle(
          () => original.apply(this, [event, context, wrappedCallback]),
          error => {
            if (error != null) {
              // Exception thrown synchronously before resolving callback / promise.
              plugin._applyResponseHook(span, error);
              plugin._endSpan(span, error, () => {});
            }
          }
        ) as Promise<{}> | undefined;

        return plugin._handlePromiseResult(span, maybePromise);
      });
    };
  }

  private _createSpanForRequest(
    event: any,
    context: Context,
    requestIsColdStart: boolean,
    parent: OtelContext
  ): Span {
    const name = context.functionName;
    return this.tracer.startSpan(
      name,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [ATTR_FAAS_EXECUTION]: context.awsRequestId,
          [ATTR_FAAS_ID]: context.invokedFunctionArn,
          [ATTR_CLOUD_ACCOUNT_ID]:
            CustomAwsLambdaInstrumentation._extractAccountId(
              context.invokedFunctionArn
            ),
          [ATTR_FAAS_COLDSTART]: requestIsColdStart,
          ...CustomAwsLambdaInstrumentation._extractOtherEventFields(event),
        },
      },
      parent
    );
  }

  private _applyRequestHook(span: Span, event: any, context: Context): void {
    const { requestHook } = this.getConfig();
    if (requestHook) {
      safeExecuteInTheMiddle(
        () => requestHook(span, { event, context }),
        e => {
          if (e)
            this._diag.error(
              'aws-lambda instrumentation: requestHook error',
              e
            );
        },
        true
      );
    }
  }

  private _handlePromiseResult(
    span: Span,
    maybePromise: Promise<{}> | undefined
  ): Promise<{}> | undefined {
    if (typeof maybePromise?.then === 'function') {
      return maybePromise.then(
        value => {
          this._applyResponseHook(span, null, value);
          return new Promise<any>(resolve =>
            this._endSpan(span, undefined, () => resolve(value))
          );
        },
        (err: Error | string) => {
          this._applyResponseHook(span, err);
          return new Promise<any>((resolve, reject) =>
            this._endSpan(span, err, () => reject(err))
          );
        }
      );
    }

    // Handle synchronous return values by ending the span and applying response hook
    this._applyResponseHook(span, null, maybePromise);
    this._endSpan(span, undefined, () => {});
    return maybePromise;
  }

  private _determineParent(event: any, context: Context): OtelContext {
    const config = this.getConfig();
    const eventContextExtractor =
      config.eventContextExtractor ||
      CustomAwsLambdaInstrumentation._defaultEventContextExtractor;

    // Use safeExecuteInTheMiddle to handle errors gracefully in case of invalid event context extractor
    const extractedContext = safeExecuteInTheMiddle(
      () => eventContextExtractor(event, context),
      e => {
        if (e) {
          this._diag.error(
            'aws-lambda instrumentation: eventContextExtractor error',
            e
          );
        }
      },
      true
    );

    if (trace.getSpan(extractedContext)?.spanContext()) {
      return extractedContext;
    }
    return ROOT_CONTEXT;
  }

  private _isStreamingHandler<TEvent, TResult>(
    handler: Handler<TEvent, TResult> | StreamifyHandler<TEvent, TResult>
  ): handler is StreamifyHandler<TEvent, TResult> {
    return (
      (handler as unknown as Record<symbol, unknown>)[
        AWS_HANDLER_STREAMING_SYMBOL
      ] === AWS_HANDLER_STREAMING_RESPONSE
    );
  }

  override setTracerProvider(tracerProvider: TracerProvider) {
    super.setTracerProvider(tracerProvider);
    this._traceForceFlusher = this._traceForceFlush(tracerProvider);
  }

  private _traceForceFlush(tracerProvider: TracerProvider) {
    if (!tracerProvider) return undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentProvider: any = tracerProvider;

    if (typeof currentProvider.getDelegate === 'function') {
      currentProvider = currentProvider.getDelegate();
    }

    if (typeof currentProvider.forceFlush === 'function') {
      return currentProvider.forceFlush.bind(currentProvider);
    }

    return undefined;
  }

  override setMeterProvider(meterProvider: MeterProvider) {
    super.setMeterProvider(meterProvider);
    this._metricForceFlusher = this._metricForceFlush(meterProvider);
  }

  private _metricForceFlush(meterProvider: MeterProvider) {
    if (!meterProvider) return undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentProvider: any = meterProvider;

    if (typeof currentProvider.forceFlush === 'function') {
      return currentProvider.forceFlush.bind(currentProvider);
    }

    return undefined;
  }

  private _wrapCallback(original: Callback, span: Span): Callback {
    const plugin = this;
    return function wrappedCallback(this: never, err, res) {
      plugin._diag.debug('executing wrapped lookup callback function');
      plugin._applyResponseHook(span, err, res);

      plugin._endSpan(span, err, () => {
        plugin._diag.debug('executing original lookup callback function');
        return original.apply(this, [err, res]);
      });
    };
  }

  private _endSpan(
    span: Span,
    err: string | Error | null | undefined,
    callback: () => void
  ) {
    if (err) {
      span.recordException(err);
    }

    let errMessage;
    if (typeof err === 'string') {
      errMessage = err;
    } else if (err) {
      errMessage = err.message;
    }
    if (errMessage) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errMessage,
      });
    }

    span.end();

    const flushers: Promise<void>[] = [];
    if (this._traceForceFlusher) {
      flushers.push(this._traceForceFlusher());
    } else {
      this._diag.debug(
        'Spans may not be exported for the lambda function because we are not force flushing before callback.'
      );
    }
    if (this._metricForceFlusher) {
      flushers.push(this._metricForceFlusher());
    } else {
      this._diag.debug(
        'Metrics may not be exported for the lambda function because we are not force flushing before callback.'
      );
    }

    Promise.all(flushers).then(callback, callback);
  }

  private _applyResponseHook(
    span: Span,
    err?: Error | string | null,
    res?: any
  ) {
    const { responseHook } = this.getConfig();
    if (responseHook) {
      safeExecuteInTheMiddle(
        () => responseHook(span, { err, res }),
        e => {
          if (e)
            this._diag.error(
              'aws-lambda instrumentation: responseHook error',
              e
            );
        },
        true
      );
    }
  }

  private static _extractAccountId(arn: string): string | undefined {
    const parts = arn.split(':');
    if (parts.length >= 5) {
      return parts[4];
    }
    return undefined;
  }

  private static _defaultEventContextExtractor(event: any): OtelContext {
    // The default extractor tries to get sampled trace header from HTTP headers.
    const httpHeaders = event.headers || {};
    return propagation.extract(otelContext.active(), httpHeaders, headerGetter);
  }

  private static _extractOtherEventFields(event: any): Attributes {
    const answer: Attributes = {};
    const fullUrl = this._extractFullUrl(event);
    if (fullUrl) {
      answer[ATTR_URL_FULL] = fullUrl;
    }
    return answer;
  }

  private static _extractFullUrl(event: any): string | undefined {
    // API gateway encodes a lot of url information in various places to recompute this
    if (!event.headers) {
      return undefined;
    }
    // Helper function to deal with case variations (instead of making a tolower() copy of the headers)
    function findAny(
      event: any,
      key1: string,
      key2: string
    ): string | undefined {
      return event.headers[key1] ?? event.headers[key2];
    }
    const host = findAny(event, 'host', 'Host');
    const proto = findAny(event, 'x-forwarded-proto', 'X-Forwarded-Proto');
    const port = findAny(event, 'x-forwarded-port', 'X-Forwarded-Port');
    if (!(proto && host && (event.path || event.rawPath))) {
      return undefined;
    }
    let answer = proto + '://' + host;
    if (port) {
      answer += ':' + port;
    }
    answer += event.path ?? event.rawPath;
    if (event.queryStringParameters) {
      let first = true;
      for (const key in event.queryStringParameters) {
        answer += first ? '?' : '&';
        answer += encodeURIComponent(key);
        answer += '=';
        answer += encodeURIComponent(event.queryStringParameters[key]);
        first = false;
      }
    }
    return answer;
  }
}
