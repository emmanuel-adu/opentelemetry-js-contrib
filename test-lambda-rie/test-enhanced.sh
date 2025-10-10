#!/bin/bash

echo "🧪 Enhanced Lambda RIE Test - Validating Traces"
echo ""

# Invoke the function
echo "📤 Invoking Lambda function..."
RESPONSE=$(curl -s -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{
    "path": "/test",
    "httpMethod": "GET",
    "headers": {
      "User-Agent": "RIE-Test/1.0"
    },
    "requestContext": {
      "requestId": "test-request-123",
      "accountId": "123456789012"
    },
    "isBase64Encoded": false
  }')

echo ""
echo "📥 Response received:"
echo "$RESPONSE" | jq '.'

# Get logs and check for trace indicators
echo ""
echo "📋 Checking for OpenTelemetry traces..."
echo "─────────────────────────────────────────────────────────────"

LOGS=$(docker logs lambda-rie-test 2>&1 | tail -50)

# Check for REQUEST HOOK
if echo "$LOGS" | grep -q "REQUEST HOOK"; then
  REQUEST_HOOK=$(echo "$LOGS" | grep "REQUEST HOOK" | tail -1)
  echo "✅ Request Hook: $REQUEST_HOOK"
else
  echo "⚠️  Request Hook: Not found in logs (may be truncated)"
fi

# Check for RESPONSE HOOK
if echo "$LOGS" | grep -q "RESPONSE HOOK"; then
  RESPONSE_HOOK=$(echo "$LOGS" | grep "RESPONSE HOOK" | tail -1)
  echo "✅ Response Hook: $RESPONSE_HOOK"
else
  echo "❌ Response Hook: Not found"
fi

# Check for span IDs
if echo "$LOGS" | grep -q "spanId"; then
  SPAN_ID=$(echo "$LOGS" | grep -oE "spanId['\": ]+[a-f0-9]{16}" | head -1)
  echo "✅ Span Created: $SPAN_ID"
else
  echo "❌ Span Creation: Not detected"
fi

# Check for trace IDs
if echo "$LOGS" | grep -q "traceId"; then
  TRACE_ID=$(echo "$LOGS" | grep -oE "traceId['\": ]+[a-f0-9]{32}" | head -1)
  echo "✅ Trace ID: $TRACE_ID"
else
  echo "⚠️  Trace ID: Not found in visible logs"
fi

# Check for banner patching
if echo "$LOGS" | grep -q "ESM handler successfully patched"; then
  echo "✅ ESM Banner: Handler successfully patched"
else
  echo "❌ ESM Banner: Patching not detected"
fi

# Check for instrumentation
if echo "$LOGS" | grep -q "ESM handler manually patched"; then
  echo "✅ Instrumentation: Handler manually patched (ESM)"
else
  echo "❌ Instrumentation: Not detected"
fi

echo "─────────────────────────────────────────────────────────────"
echo ""
echo "✅ Enhanced test complete!"
