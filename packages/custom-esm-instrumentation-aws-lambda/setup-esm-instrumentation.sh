#!/bin/bash

# Custom ESM Instrumentation Setup Script
# This script mimics the ADOT approach for ESM Lambda handlers

set -e

echo "[setup-esm-instrumentation] Setting up custom ESM instrumentation..."

# Lambda function root directory
TASK_DIR="/var/task"

# Determine where the instrumentation files are located
# In AWS Lambda layers, they're in /opt/, but in RIE tests they might be in /var/task/
if [ -f "/opt/custom-esm-wrapper.mjs" ]; then
    INSTRUMENTATION_DIR="/opt"
elif [ -f "/var/task/custom-esm-wrapper.mjs" ]; then
    INSTRUMENTATION_DIR="/var/task"
else
    echo "[setup-esm-instrumentation] ERROR: Cannot find instrumentation files" >&2
    exit 1
fi

echo "[setup-esm-instrumentation] Using instrumentation files from: $INSTRUMENTATION_DIR"

# Flag variables to track conditions
found_mjs=false
is_module=false

# Check for any files ending with `.mjs`
if ls "$TASK_DIR"/*.mjs &>/dev/null; then
    found_mjs=true
    echo "[setup-esm-instrumentation] Found .mjs files in task directory"
fi

# Check if `package.json` exists and if it contains `"type": "module"`
if [ -f "$TASK_DIR/package.json" ]; then
    # Check for the `"type": "module"` attribute in `package.json`
    if grep -q '"type": *"module"' "$TASK_DIR/package.json"; then
        is_module=true
        echo "[setup-esm-instrumentation] Found 'type: module' in package.json"
    fi
fi

# Check if we should use ESM instrumentation
if $found_mjs || $is_module; then
    echo "[setup-esm-instrumentation] ESM handler detected, setting up ESM instrumentation"

    # Set up ESM-specific NODE_OPTIONS
    if [ -z "$NODE_OPTIONS" ]; then
        export NODE_OPTIONS=""
    fi

    # Add ESM loader and import flags
    export NODE_OPTIONS="${NODE_OPTIONS} --import ${INSTRUMENTATION_DIR}/custom-esm-wrapper.mjs --experimental-loader=${INSTRUMENTATION_DIR}/custom-esm-loader.mjs"
    export HANDLER_IS_ESM=true

    echo "[setup-esm-instrumentation] NODE_OPTIONS set to: $NODE_OPTIONS"
else
    echo "[setup-esm-instrumentation] CommonJS handler detected, using traditional instrumentation"

    # Set up CommonJS instrumentation
    if [ -z "$NODE_OPTIONS" ]; then
        export NODE_OPTIONS=""
    fi

    export NODE_OPTIONS="${NODE_OPTIONS} --require ${INSTRUMENTATION_DIR}/custom-instrumentation-setup.js"
    export HANDLER_IS_ESM=false

    echo "[setup-esm-instrumentation] NODE_OPTIONS set to: $NODE_OPTIONS"
fi

echo "[setup-esm-instrumentation] Setup complete"
