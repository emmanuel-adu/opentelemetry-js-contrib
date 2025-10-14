/**
 * Example usage of custom AWS Lambda instrumentation with NodeSDK
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { CustomAwsLambdaInstrumentation } from './custom-aws-lambda-instrumentation';

// Example 1: Basic setup - just add to your instrumentations array
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
      // Optional configuration
      version: '2.0.0', // Custom version for your instrumentation
      requestHook: (span, event, context) => {
        // Add custom attributes to the span
        span.setAttributes({
          'http.method': event.httpMethod,
          'http.url': event.path,
          'user.id': event.headers?.['x-user-id'] || 'anonymous',
          'request.size': JSON.stringify(event).length,
        });
      },
      responseHook: (span, err, res) => {
        if (res) {
          span.setAttributes({
            'http.status_code': res.statusCode,
            'response.size': JSON.stringify(res).length,
          });
        }
      },
    }),
  ],
});

// Start the SDK
sdk.start();

// Example 2: Advanced setup with custom context extraction
const advancedSdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'advanced-api-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  instrumentations: [
    new CustomAwsLambdaInstrumentation({
      // Custom trace context extraction
      eventContextExtractor: (event, context) => {
        // Extract trace context from custom headers
        const traceHeader = event.headers?.['x-custom-trace-id'];
        if (traceHeader) {
          // Custom trace context extraction logic
          // Return the extracted context
          return customTraceContext;
        }

        // Fall back to default HTTP header extraction
        const httpHeaders = event.headers || {};
        return propagation.extract(
          otelContext.active(),
          httpHeaders,
          headerGetter
        );
      },

      // Custom request hook
      requestHook: (span, event, context) => {
        span.setAttributes({
          'custom.tenant_id': event.headers?.['x-tenant-id'],
          'custom.request_id': event.requestContext?.requestId,
          'custom.stage': event.requestContext?.stage,
        });
      },

      // Custom response hook
      responseHook: (span, err, res) => {
        if (err) {
          span.setAttributes({
            'error.type': err.constructor.name,
            'error.message': err.message,
          });
        }

        if (res) {
          span.setAttributes({
            'response.status_code': res.statusCode,
            'response.content_type': res.headers?.['Content-Type'],
          });
        }
      },
    }),
  ],
});

// Example 3: Minimal setup - just the basics
const minimalSdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'minimal-api-service',
  }),
  instrumentations: [
    // Just add it - no configuration needed!
    new CustomAwsLambdaInstrumentation(),
  ],
});

// Example 4: Using your own version constant
const PACKAGE_VERSION = '1.0.0'; // Your custom version

const versionedSdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'versioned-api-service',
  }),
  instrumentations: [
    new CustomAwsLambdaInstrumentation({
      version: PACKAGE_VERSION, // Use your version constant
      requestHook: (span, event, context) => {
        span.setAttributes({
          'custom.version': PACKAGE_VERSION,
          'custom.service': 'my-service',
        });
      },
    }),
  ],
});

export { sdk, advancedSdk, minimalSdk, versionedSdk };
