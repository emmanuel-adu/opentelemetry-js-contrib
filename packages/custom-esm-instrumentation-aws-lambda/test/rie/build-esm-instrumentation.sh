#!/bin/bash

# Build script for ESM instrumentation in RIE test

echo "🔧 Building ESM instrumentation for Lambda RIE test..."

# Copy custom instrumentation source files
echo "📋 Copying custom instrumentation source files..."
cp ../../src/instrumentation.ts ./custom-instrumentation.ts
cp ../../src/types.ts ./types.ts

# Compile TypeScript to CommonJS
echo "🔨 Compiling TypeScript to CommonJS..."
npx tsc custom-instrumentation.ts types.ts --target ES2020 --module CommonJS --outDir . --skipLibCheck

# Rename the compiled files
mv custom-instrumentation.js custom-instrumentation-compiled.cjs
mv types.js types.cjs

echo "✅ ESM instrumentation compiled to custom-instrumentation-compiled.cjs"

# Show file sizes
echo "📦 Files created:"
ls -lh custom-instrumentation-compiled.cjs custom-instrumentation.ts types.ts types.cjs

echo "✅ Build complete! You can now test with: npm run test:esm"
