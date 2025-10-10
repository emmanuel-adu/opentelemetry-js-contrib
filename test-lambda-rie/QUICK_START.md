# 🚀 Quick Start - Lambda RIE Test

## One Command Test

```bash
npm test
```

That's it! This will:

- ✅ Build Docker image
- ✅ Start Lambda container
- ✅ Invoke function
- ✅ Show traces
- ✅ Stop container

## What You'll See

```bash
$ npm test

✅ Docker image built
✅ Container started

{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "..."
}

✅ Banner: ESM handler successfully patched with OpenTelemetry
✅ [RESPONSE HOOK] Span ending: { spanId: '3713f1b4fa4db729', hasError: false, statusCode: 200 }

✅ Container stopped
```

## Quick Commands

| Command          | What It Does                |
| ---------------- | --------------------------- |
| `npm test`       | Full test (recommended)     |
| `npm run build`  | Build Docker image only     |
| `npm run start`  | Start Lambda container      |
| `npm run invoke` | Invoke Lambda + show traces |
| `npm run logs`   | Live logs                   |
| `npm run stop`   | Stop container              |
| `npm run clean`  | Clean everything            |

## Need More Info?

See [README.md](./README.md) for detailed documentation.

## Troubleshooting

### Error: "container name already in use"

```bash
docker rm -f lambda-rie-test
npm test
```

### No trace logs showing

```bash
npm run logs
```

### Port 9000 in use

```bash
lsof -i :9000
# Kill the process or change port in docker-compose.yml
```

## Test Results

See [FINAL_TEST_RESULTS.md](./FINAL_TEST_RESULTS.md) for complete test results with trace IDs and span details.
