#!/bin/bash
set -e

echo "🧪 Testing Lambda function with RIE..."
echo ""

# Check if container is running
if ! docker ps | grep -q lambda-rie-test; then
  echo "❌ Container is not running. Start it with: ./run.sh"
  exit 1
fi

echo "📤 Invoking Lambda function..."
echo ""

# Invoke the function
response=$(curl -s -X POST \
  "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d @event.json)

echo "📥 Response received:"
echo "$response" | jq . 2>/dev/null || echo "$response"
echo ""

# Show container logs
echo "📋 Container logs (last 50 lines):"
echo "─────────────────────────────────────────────────────────────"
docker logs lambda-rie-test 2>&1 | tail -50
echo "─────────────────────────────────────────────────────────────"
echo ""

# Check for instrumentation success indicators
echo "🔍 Checking for instrumentation indicators..."
if docker logs lambda-rie-test 2>&1 | grep -q "REQUEST HOOK"; then
  echo "✅ Request hook called"
else
  echo "❌ Request hook NOT called"
fi

if docker logs lambda-rie-test 2>&1 | grep -q "RESPONSE HOOK"; then
  echo "✅ Response hook called"
else
  echo "❌ Response hook NOT called"
fi

if docker logs lambda-rie-test 2>&1 | grep -q "Instrumenting lambda handler"; then
  echo "✅ Handler instrumentation detected"
else
  echo "❌ Handler instrumentation NOT detected"
fi

if docker logs lambda-rie-test 2>&1 | grep -q "Span created"; then
  echo "✅ Span creation detected"
else
  echo "❌ Span creation NOT detected"
fi

echo ""
echo "✅ Test complete!"

