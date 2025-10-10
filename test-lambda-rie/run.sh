#!/bin/bash
set -e

echo "🚀 Starting Lambda RIE test container..."
echo ""

# Stop any existing container
docker stop lambda-rie-test 2>/dev/null || true
docker rm lambda-rie-test 2>/dev/null || true

# Run the container
docker run -d \
  --name lambda-rie-test \
  -p 9000:8080 \
  -e OTEL_DEBUG_ENABLED=true \
  lambda-rie-test:latest

echo "✅ Container started"
echo ""
echo "Container is running on http://localhost:9000"
echo ""
echo "To test the function:"
echo "  ./test.sh"
echo ""
echo "To view logs:"
echo "  docker logs -f lambda-rie-test"
echo ""
echo "To stop:"
echo "  docker stop lambda-rie-test"

