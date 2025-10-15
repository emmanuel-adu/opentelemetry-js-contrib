# RIE Test for Custom ESM Instrumentation

This directory contains tests for the custom ESM instrumentation using AWS Lambda Runtime Interface Emulator (RIE).

## 📁 File Structure

```
test/rie/
├── README.md                            # This file
├── test-esm-instrumentation.sh          # Main test setup script
├── build-esm-instrumentation.sh         # Script to build the instrumentation
├── docker-compose.esm.yml               # Docker Compose configuration
├── Dockerfile.esm                       # Dockerfile for ESM test
└── (generated files during test)
    ├── handler.mjs                      # Test ESM handler
    ├── package.json                     # Package configuration
    ├── event.json                       # Test event
    ├── custom-instrumentation-compiled.cjs  # Compiled instrumentation
    ├── custom-esm-loader.mjs            # ESM loader
    ├── custom-esm-wrapper.mjs           # ESM wrapper
    ├── setup-esm-instrumentation.sh     # Setup script
    └── otel-handler-custom-esm          # Lambda wrapper script
```

## 🚀 Running the Test

### Setup and Run

```bash
# From the package root
cd /Users/emmanueladu/Development/open-source-otel/opentelemetry-js-contrib/packages/custom-esm-instrumentation-aws-lambda

# Run the test setup script
./test/rie/test-esm-instrumentation.sh

# Then run the test
cd test/rie
npm run test:esm
```

### Individual Commands

```bash
# Build the instrumentation
npm run build:esm

# Start the container
npm run start:esm

# Invoke the function
npm run invoke:esm

# Check logs
npm run logs:esm
npm run check:esm

# Stop the container
npm run stop:esm

# Clean up test files
npm run clean:esm
```

## 🎯 What the Test Does

1. **Compiles the instrumentation** from TypeScript to CommonJS
2. **Creates test files**:
   - ESM handler (`handler.mjs`)
   - ESM wrapper that loads the compiled instrumentation
   - ESM loader for module interception
   - Setup script for ESM detection
3. **Builds a Docker image** with:
   - Node.js 20 Lambda runtime
   - OpenTelemetry dependencies
   - Custom instrumentation files
4. **Starts the Lambda RIE** with the ESM wrapper
5. **Invokes the handler** via HTTP POST
6. **Captures logs** to verify instrumentation

## ✅ Test Results

### What Works

- ✅ ESM environment detection (`.mjs` files, `package.json` type)
- ✅ Dynamic path resolution (`/opt/` vs `/var/task/`)
- ✅ ESM loader registration (`--experimental-loader`)
- ✅ ESM wrapper initialization (`--import`)
- ✅ Custom instrumentation loading and initialization
- ✅ Setup script execution

### Expected Logs

```
[setup-esm-instrumentation] ESM handler detected, setting up ESM instrumentation
[setup-esm-instrumentation] Using instrumentation files from: /var/task
✅ [ESM Wrapper] Custom AWS Lambda instrumentation initialized
```

## ⚠️ Known Limitations

### RIE Environment Limitations

The RIE (Runtime Interface Emulator) has different module loading behavior than the actual AWS Lambda environment:

1. **`Function.prototype.apply` interception causes infinite recursion** in RIE

   - The aggressive function patching in `_setupDirectHandlerInterceptor` works in real Lambda but not in RIE
   - This is because RIE's internal operations trigger the interceptor recursively

2. **Runtime patching timing**
   - RIE loads modules differently than the actual Lambda runtime
   - Some patching strategies that work in production may not work in RIE

### Recommendation

**Test in actual AWS Lambda environment** for accurate results. The RIE is useful for validating:

- ESM detection logic
- File path resolution
- Wrapper script execution
- Basic initialization

But the actual handler patching and instrumentation should be tested in a real Lambda function.

## 🔧 Troubleshooting

### Issue: "Cannot find module"

**Solution**: Ensure all dependencies are installed in the Dockerfile:

```dockerfile
RUN npm install --omit=dev --insecure \
    @opentelemetry/api \
    @opentelemetry/instrumentation \
    @opentelemetry/semantic-conventions \
    @opentelemetry/core \
    @opentelemetry/sdk-trace-base \
    @opentelemetry/resources \
    import-in-the-middle
```

### Issue: "Identifier 'resolve' has already been declared"

**Solution**: Rename conflicting imports in `esm-loader.mjs`:

```javascript
import { resolve as resolvePath } from 'path';
```

### Issue: "Maximum call stack size exceeded"

**Solution**: This is expected in RIE due to aggressive function patching. Disable `_setupDirectHandlerInterceptor` for RIE tests or test in real AWS Lambda.

## 📝 Notes

- The test uses port `9002` to avoid conflicts with other RIE instances
- The `--insecure` flag is used for npm install to bypass SSL issues in Docker
- The ESM wrapper creates a `require` function using `createRequire` to load the CJS compiled instrumentation
- The setup script automatically detects ESM vs CommonJS based on file extensions and `package.json`
