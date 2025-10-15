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

    // Store reference globally for ESM interceptors to access
    (global as any).__aws_lambda_esm_instrumentation = this;

    // Check if we're in an ESM environment
    if (this._isESMEnvironment()) {
      this._diag.debug('ESM environment detected');
      this._setupESMSpecificPatching();
    } else {
      this._diag.debug('CommonJS environment detected');
      // Patch handlers immediately - no setTimeout needed
      // The instrumentation is loaded before user code, so this is safe
      this._patchSpecificHandler();
      this._setupHandlerInterceptor();
    }

    this._isInstrumented = true;
  }

  /**
   * Check if we're in an ESM environment
   */
  private _isESMEnvironment(): boolean {
    // Check if we're using ESM loader
    if (
      process.env.NODE_OPTIONS &&
      process.env.NODE_OPTIONS.includes('--experimental-loader')
    ) {
      return true;
    }

    // Check if we have .mjs files in the task directory
    try {
      const fs = require('fs');
      const taskRoot = process.env.LAMBDA_TASK_ROOT || '/var/task';
      const files = fs.readdirSync(taskRoot);
      if (files.some((file: string) => file.endsWith('.mjs'))) {
        return true;
      }
    } catch (error) {
      this._diag.debug('Could not check task directory for .mjs files', {
        error: (error as Error).message,
      });
    }

    // Check package.json for "type": "module"
    try {
      const fs = require('fs');
      const path = require('path');
      const taskRoot = process.env.LAMBDA_TASK_ROOT || '/var/task';
      const packageJsonPath = path.join(taskRoot, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8')
        );
        if (packageJson.type === 'module') {
          return true;
        }
      }
    } catch (error) {
      this._diag.debug('Could not check package.json for ESM type', {
        error: (error as Error).message,
      });
    }

    return false;
  }

  /**
   * Set up ESM-specific patching using import-in-the-middle approach
   */
  private _setupESMSpecificPatching(): void {
    const functionName = this._getHandlerFunctionName();
    if (!functionName) return;

    this._diag.debug('Setting up ESM patching', { functionName });

    // Try to use import-in-the-middle if available
    try {
      // Check if import-in-the-middle is available
      const importInTheMiddle = require('import-in-the-middle');
      if (importInTheMiddle && typeof importInTheMiddle.hook === 'function') {
        this._diag.debug('Using import-in-the-middle for ESM patching', {
          functionName,
        });

        // Hook into ESM imports
        importInTheMiddle.hook(
          (name: string, resolve: any, getSource: any, getFormat: any) => {
            this._diag.debug('ESM module being imported', { moduleName: name });

            // Check if this is our handler module
            if (name.includes('lambda') || name.endsWith('.mjs')) {
              this._diag.debug('Handler module detected in ESM import', {
                moduleName: name,
              });

              // Get the module source and modify it
              const source = getSource();
              if (source && source.includes(`export.*${functionName}`)) {
                this._diag.debug('Found handler export in ESM module', {
                  moduleName: name,
                  functionName,
                });

                // We need to patch the handler when the module is loaded
                // This is a simplified approach - in reality, we'd need to modify the source
                setTimeout(() => {
                  try {
                    // Try to find and patch the handler after module loads
                    const handlerModule = this._getModuleFromRegistry(name);
                    if (
                      handlerModule &&
                      typeof handlerModule[functionName] === 'function'
                    ) {
                      const patchedHandler = this._patchHandler(
                        handlerModule[functionName],
                        functionName
                      );
                      handlerModule[functionName] = patchedHandler;
                      this._diag.debug('Handler patched in ESM module', {
                        moduleName: name,
                        functionName,
                      });
                    }
                  } catch (error) {
                    this._diag.debug('Failed to patch ESM handler', {
                      error: (error as Error).message,
                    });
                  }
                }, 10);
              }
            }

            return resolve(name);
          }
        );

        return;
      }
    } catch (error) {
      this._diag.debug(
        'import-in-the-middle not available, falling back to alternative approach',
        {
          error: (error as Error).message,
        }
      );
    }

    // Fallback: Use the direct handler interceptor approach
    this._diag.debug('Using fallback ESM patching', { functionName });
    this._setupDirectHandlerInterceptor(functionName);
  }

  /**
   * Patch the specific handler defined in process.env._HANDLER
   */
  private _patchSpecificHandler(): void {
    const functionName = this._getHandlerFunctionName();
    if (!functionName) return;

    this._diag.debug('Attempting to patch specific handler', { functionName });

    // Try multiple approaches to find and patch the handler
    let handlerPatched = false;

    // 1. Try global scope
    if (typeof (globalThis as any)[functionName] === 'function') {
      this._patchHandler((globalThis as any)[functionName], functionName);
      this._diag.debug('Patched handler in global scope', { functionName });
      handlerPatched = true;
    }

    // 2. Try CommonJS module.exports
    if (
      !handlerPatched &&
      typeof module !== 'undefined' &&
      module.exports &&
      typeof module.exports[functionName] === 'function'
    ) {
      this._patchHandler(module.exports[functionName], functionName);
      this._diag.debug('Patched handler in module.exports', { functionName });
      handlerPatched = true;
    }

    // 3. Try ESM module registry (for serverless-esbuild scenarios)
    if (!handlerPatched) {
      try {
        const modulePath = this._getHandlerModulePath();
        if (modulePath) {
          const handlerModule = this._getModuleFromRegistry(modulePath);
          if (
            handlerModule &&
            typeof handlerModule[functionName] === 'function'
          ) {
            this._patchHandler(handlerModule[functionName], functionName);
            this._diag.debug('Patched handler from ESM module registry', {
              functionName,
              modulePath,
            });
            handlerPatched = true;
          }
        }
      } catch (error) {
        this._diag.debug('Failed to access ESM module registry', {
          error: (error as Error).message,
        });
      }
    }

    if (!handlerPatched) {
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

    this._diag.debug('Setting up handler interceptor', { functionName });

    // Track whether we've successfully patched the handler
    let handlerPatched = false;

    // Intercept global handler assignments - only for the specific handler function
    const originalDefineProperty = Object.defineProperty;
    (Object.defineProperty as any) = <T>(
      target: T,
      property: PropertyKey,
      descriptor: PropertyDescriptor
    ): T => {
      this._diag.debug('Object.defineProperty intercepted', {
        property: String(property),
        hasValue: !!descriptor.value,
        isFunction: typeof descriptor.value === 'function',
      });

      // Only intercept if we haven't patched yet
      if (
        !handlerPatched &&
        typeof descriptor.value === 'function' &&
        String(property) === functionName &&
        this._isHandlerFunction(descriptor.value)
      ) {
        this._diag.debug('Patching handler via Object.defineProperty', {
          functionName,
        });
        descriptor.value = this._patchHandler(
          descriptor.value,
          String(property)
        );
        handlerPatched = true;

        // Restore original Object.defineProperty after successful patch
        Object.defineProperty = originalDefineProperty;
        this._diag.debug(
          'Handler patched successfully via Object.defineProperty, restored original'
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

    // Intercept ESM module loading for serverless-esbuild scenarios
    this._setupESMInterceptor(
      functionName,
      handlerPatched,
      originalDefineProperty
    );

    // Set up a fallback interceptor that patches the handler when it's first called
    this._setupFallbackInterceptor(functionName);

    // Set up ESM export interception
    this._setupESMExportInterceptor(functionName);

    // Set up direct handler execution interception
    this._setupDirectHandlerInterceptor(functionName);
  }

  /**
   * Set up ESM module loading interception
   */
  private _setupESMInterceptor(
    functionName: string,
    handlerPatched: boolean,
    originalDefineProperty: any
  ): void {
    // Monitor for ESM module loading by intercepting require/import
    const originalRequire = require;

    // Wrap require to catch module loading
    (global as any).require = function (id: string) {
      const result = originalRequire.apply(this, arguments as any);

      // Check if this is our handler module being loaded
      if (id.endsWith('.mjs') || id.includes('lambda')) {
        const instrumentation = (global as any)
          .__aws_lambda_esm_instrumentation;
        if (
          instrumentation &&
          typeof result === 'object' &&
          result[functionName]
        ) {
          try {
            const patchedFunction = instrumentation._patchHandler(
              result[functionName],
              functionName
            );
            (result as any)[functionName] = patchedFunction;
            instrumentation._diag.debug('Patched ESM handler during require', {
              functionName,
              moduleId: id,
            });
          } catch (error) {
            instrumentation._diag.debug(
              'Failed to patch ESM handler during require',
              {
                functionName,
                moduleId: id,
                error: (error as Error).message,
              }
            );
          }
        }
      }

      return result;
    };

    // Also try to intercept dynamic imports
    const originalImport = (global as any).import;
    if (typeof originalImport === 'function') {
      (global as any).import = function (id: string) {
        return originalImport(id).then((module: any) => {
          // Check if this is our handler module
          if (id.endsWith('.mjs') || id.includes('lambda')) {
            const instrumentation = (global as any)
              .__aws_lambda_esm_instrumentation;
            if (
              instrumentation &&
              typeof module === 'object' &&
              module[functionName]
            ) {
              try {
                const patchedFunction = instrumentation._patchHandler(
                  module[functionName],
                  functionName
                );
                module[functionName] = patchedFunction;
                instrumentation._diag.debug(
                  'Patched ESM handler during dynamic import',
                  { functionName, moduleId: id }
                );
              } catch (error) {
                instrumentation._diag.debug(
                  'Failed to patch ESM handler during dynamic import',
                  {
                    functionName,
                    moduleId: id,
                    error: (error as Error).message,
                  }
                );
              }
            }
          }
          return module;
        });
      };
    }
  }

  /**
   * Set up a fallback interceptor that patches the handler when it's first called
   */
  private _setupFallbackInterceptor(functionName: string): void {
    this._diag.debug('Setting up fallback interceptor', { functionName });

    // Set up a timer to periodically check for the handler
    const checkInterval = setInterval(() => {
      try {
        // Try to find the handler in various locations
        const handlerModulePath = this._getHandlerModulePath();
        if (handlerModulePath) {
          const handlerModule = this._getModuleFromRegistry(handlerModulePath);
          if (
            handlerModule &&
            typeof handlerModule[functionName] === 'function'
          ) {
            this._diag.debug('Found handler via fallback interceptor', {
              functionName,
            });

            // Patch the handler
            const originalHandler = handlerModule[functionName];
            const patchedHandler = this._patchHandler(
              originalHandler,
              functionName
            );
            handlerModule[functionName] = patchedHandler;

            this._diag.debug('Handler patched via fallback interceptor', {
              functionName,
            });
            clearInterval(checkInterval);
          }
        }

        // Also try global scope
        if (typeof (globalThis as any)[functionName] === 'function') {
          this._diag.debug(
            'Found handler in global scope via fallback interceptor',
            { functionName }
          );

          const originalHandler = (globalThis as any)[functionName];
          const patchedHandler = this._patchHandler(
            originalHandler,
            functionName
          );
          (globalThis as any)[functionName] = patchedHandler;

          this._diag.debug(
            'Handler patched in global scope via fallback interceptor',
            { functionName }
          );
          clearInterval(checkInterval);
        }
      } catch (error) {
        this._diag.debug('Fallback interceptor error', {
          functionName,
          error: (error as Error).message,
        });
      }
    }, 100); // Check every 100ms

    // Clear the interval after 30 seconds to avoid infinite checking
    setTimeout(() => {
      clearInterval(checkInterval);
      this._diag.debug('Fallback interceptor timeout, stopped checking', {
        functionName,
      });
    }, 30000);
  }

  /**
   * Set up ESM export interception by monitoring module loading
   */
  private _setupESMExportInterceptor(functionName: string): void {
    this._diag.debug('Setting up ESM export interceptor', { functionName });

    // Intercept require.resolve to catch when modules are being resolved
    const originalResolve = require.resolve;
    (require.resolve as any) = function (this: any, id: string) {
      const result = originalResolve.apply(this, arguments as any);

      // Check if this is our handler module being resolved
      if (id.includes('lambda') || id.endsWith('.mjs')) {
        const instrumentation = (global as any)
          .__aws_lambda_esm_instrumentation;
        if (instrumentation) {
          instrumentation._diag.debug('Module being resolved', {
            moduleId: id,
            resolvedPath: result,
          });

          // Try to access the module from the cache after a short delay
          setTimeout(() => {
            try {
              const Module = require('module');
              if (Module._cache && Module._cache[result]) {
                const moduleExports = Module._cache[result].exports;
                if (
                  moduleExports &&
                  typeof moduleExports[functionName] === 'function'
                ) {
                  instrumentation._diag.debug(
                    'Found handler in resolved module',
                    {
                      functionName,
                      moduleId: id,
                      resolvedPath: result,
                    }
                  );

                  // Patch the handler
                  const originalHandler = moduleExports[functionName];
                  const patchedHandler = instrumentation._patchHandler(
                    originalHandler,
                    functionName
                  );
                  moduleExports[functionName] = patchedHandler;

                  instrumentation._diag.debug(
                    'Handler patched in resolved module',
                    {
                      functionName,
                      moduleId: id,
                    }
                  );
                }
              }
            } catch (error) {
              instrumentation._diag.debug('Error accessing resolved module', {
                moduleId: id,
                error: (error as Error).message,
              });
            }
          }, 10); // Small delay to ensure module is fully loaded
        }
      }

      return result;
    };

    // Also intercept the require function itself
    const originalRequire = require;
    (global as any).require = function (id: string) {
      const result: any = originalRequire.apply(this, arguments as any);

      // Check if this is our handler module being required
      if (id.includes('lambda') || id.endsWith('.mjs')) {
        const instrumentation = (global as any)
          .__aws_lambda_esm_instrumentation;
        if (
          instrumentation &&
          result &&
          typeof result === 'object' &&
          typeof (result as any)[functionName] === 'function'
        ) {
          instrumentation._diag.debug('Found handler in required module', {
            functionName,
            moduleId: id,
          });

          // Patch the handler
          const originalHandler = result[functionName];
          const patchedHandler = instrumentation._patchHandler(
            originalHandler,
            functionName
          );
          (result as any)[functionName] = patchedHandler;

          instrumentation._diag.debug('Handler patched in required module', {
            functionName,
            moduleId: id,
          });
        }
      }

      return result;
    };
  }

  /**
   * Set up direct handler execution interception by monitoring the Lambda runtime
   */
  private _setupDirectHandlerInterceptor(functionName: string): void {
    this._diag.debug('Setting up direct handler execution interceptor', {
      functionName,
    });

    // Monitor for the handler being called directly by the Lambda runtime
    // This approach intercepts the actual function call

    // Store the original handler if it exists in global scope
    const originalHandler = (globalThis as any)[functionName];
    if (typeof originalHandler === 'function') {
      this._diag.debug('Found handler in global scope, patching directly', {
        functionName,
      });
      const patchedHandler = this._patchHandler(originalHandler, functionName);
      (globalThis as any)[functionName] = patchedHandler;
      return;
    }

    // If not in global scope, set up a proxy that will catch when it's assigned
    let handlerPatched = false;

    // Use a more aggressive approach - monitor all property assignments on globalThis
    // Intercept all property assignments on globalThis
    const globalProxy = new Proxy(globalThis as any, {
      set: (target: any, property: string | symbol, value: any) => {
        if (
          !handlerPatched &&
          String(property) === functionName &&
          typeof value === 'function' &&
          this._isHandlerFunction(value)
        ) {
          this._diag.debug(
            'Handler assigned to global scope, patching immediately',
            {
              functionName,
              property: String(property),
            }
          );

          const patchedHandler = this._patchHandler(value, String(property));
          handlerPatched = true;

          // Set the patched handler
          target[property] = patchedHandler;
          return true;
        }

        // For all other properties, set normally
        target[property] = value;
        return true;
      },
      get: (target: any, property: string | symbol) => {
        return target[property];
      },
    });

    // Replace globalThis with our proxy
    (global as any).globalThis = globalProxy;

    // Also try to intercept the handler when it's called by the Lambda runtime
    // This is a last resort approach
    const originalCall = Function.prototype.call;
    const originalApply = Function.prototype.apply;

    Function.prototype.call = function (this: any, ...args: any[]) {
      if (
        !handlerPatched &&
        this &&
        this.name === functionName &&
        this.length >= 2 &&
        args.length >= 2
      ) {
        const instrumentation = (global as any)
          .__aws_lambda_esm_instrumentation;
        if (instrumentation) {
          instrumentation._diag.debug(
            'Handler function called, patching on first call',
            {
              functionName,
              argsLength: args.length,
            }
          );

          const patchedHandler = instrumentation._patchHandler(
            this,
            functionName
          );
          handlerPatched = true;

          // Restore original methods
          Function.prototype.call = originalCall;
          Function.prototype.apply = originalApply;

          return patchedHandler.call(this, ...args);
        }
      }

      return originalCall.apply(this, args as any);
    };

    Function.prototype.apply = function (this: any, thisArg: any, args: any[]) {
      if (
        !handlerPatched &&
        this &&
        this.name === functionName &&
        this.length >= 2 &&
        args &&
        args.length >= 2
      ) {
        const instrumentation = (global as any)
          .__aws_lambda_esm_instrumentation;
        if (instrumentation) {
          instrumentation._diag.debug(
            'Handler function applied, patching on first call',
            {
              functionName,
              argsLength: args.length,
            }
          );

          const patchedHandler = instrumentation._patchHandler(
            this,
            functionName
          );
          handlerPatched = true;

          // Restore original methods
          Function.prototype.call = originalCall;
          Function.prototype.apply = originalApply;

          return patchedHandler.apply(thisArg, args);
        }
      }

      return originalApply.apply(this, [thisArg, args]);
    };
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
   * Get the handler module path from _HANDLER environment variable
   */
  private _getHandlerModulePath(): string | null {
    if (!this._handlerDef) return null;

    const parts = this._handlerDef.split('.');
    if (parts.length < 2) return null;

    const moduleName = parts.slice(0, -1).join('.');
    const taskRoot = process.env.LAMBDA_TASK_ROOT || '/var/task';
    return `${taskRoot}/${moduleName}.mjs`;
  }

  /**
   * Try to get module from Node.js module registry
   */
  private _getModuleFromRegistry(modulePath: string): any | null {
    try {
      // Try to access the module from Node.js internal registry
      const Module = require('module');
      if (Module._cache && Module._cache[modulePath]) {
        return Module._cache[modulePath].exports;
      }

      // Try require.resolve to find the module
      const resolvedPath = require.resolve(modulePath);
      if (Module._cache && Module._cache[resolvedPath]) {
        return Module._cache[resolvedPath].exports;
      }
    } catch (error) {
      // Module not found or not accessible
      this._diag.debug('Module not accessible from registry', {
        modulePath,
        error: (error as Error).message,
      });
    }

    return null;
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
