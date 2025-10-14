#!/bin/bash

set -e

echo "🔧 Building custom instrumentation for Lambda RIE test..."

# Copy the custom instrumentation TypeScript files
echo "📋 Copying custom instrumentation source files..."
cp ../../src/instrumentation.ts ./custom-instrumentation.ts
cp ../../src/types.ts ./types.ts  # Keep original name for imports

# Compile TypeScript to CommonJS
echo "🔨 Compiling TypeScript to CommonJS..."
npx tsc \
  --target ES2020 \
  --module commonjs \
  --lib ES2020 \
  --skipLibCheck \
  --esModuleInterop \
  --resolveJsonModule \
  --moduleResolution node \
  --outDir . \
  custom-instrumentation.ts types.ts

# Rename the output
mv custom-instrumentation.js custom-instrumentation-compiled.cjs

# Clean up intermediate files
rm -f custom-instrumentation.ts types.ts types.js

echo "✅ Custom instrumentation compiled to custom-instrumentation-compiled.cjs"
echo ""
echo "📦 Files created:"
ls -lh custom-instrumentation-compiled.cjs

echo ""
echo "✅ Build complete! You can now test with: npm run test:custom"

