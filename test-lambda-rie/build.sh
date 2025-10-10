#!/bin/bash
set -e

echo "🔨 Building Lambda RIE test with OpenTelemetry instrumentation..."
echo ""

# Build the instrumentation package
echo "📦 Building instrumentation package..."
cd ../packages/instrumentation-aws-lambda
npm run compile
echo "✅ Instrumentation built"
echo ""

# Prepare instrumentation for Docker
echo "📋 Preparing instrumentation for Docker..."
cd ../../test-lambda-rie

# Clean up old copy
rm -rf instrumentation-aws-lambda

# Create directory structure
mkdir -p instrumentation-aws-lambda

# Copy built files and package.json
cp -r ../packages/instrumentation-aws-lambda/build instrumentation-aws-lambda/
cp ../packages/instrumentation-aws-lambda/package.json instrumentation-aws-lambda/

echo "✅ Instrumentation prepared"
echo ""

# Build Docker image
echo "🐳 Building Docker image with OTel..."
docker build -t lambda-rie-test:latest .
echo "✅ Docker image built"
echo ""

echo "🎉 Build complete!"
echo ""
echo "This test validates ESM instrumentation in Lambda's real runtime."
echo "It will test:"
echo "  ✅ ESM (.mjs) handler detection"
echo "  ✅ Handler patching with OpenTelemetry"
echo "  ✅ Span creation with correct attributes"
echo "  ✅ Request/Response hooks"
echo ""
echo "Next steps:"
echo "  1. Run: ./run.sh"
echo "  2. Test: ./test.sh"
