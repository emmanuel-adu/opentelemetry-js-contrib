# Lambda Runtime Interface Emulator Test with OpenTelemetry
# This validates ESM instrumentation in a production-like Lambda environment

FROM public.ecr.aws/lambda/nodejs:20

# Copy package.json and install dependencies FIRST
COPY package.json ${LAMBDA_TASK_ROOT}/
RUN cd ${LAMBDA_TASK_ROOT} && npm install

# Copy the built instrumentation package (replaces the one from npm)
COPY instrumentation-aws-lambda/ ${LAMBDA_TASK_ROOT}/node_modules/@opentelemetry/instrumentation-aws-lambda/

# Copy the Lambda handler with final banner implementation
COPY handler-banner-final.mjs ${LAMBDA_TASK_ROOT}/handler.mjs

# Copy OpenTelemetry initialization script
COPY init-otel.cjs ${LAMBDA_TASK_ROOT}/

# Copy the exec wrapper script
COPY otel-handler ${LAMBDA_TASK_ROOT}/
RUN chmod +x ${LAMBDA_TASK_ROOT}/otel-handler

# Set Lambda environment variables
ENV _HANDLER=handler.handler
ENV AWS_LAMBDA_FUNCTION_NAME=test-esm-function
ENV AWS_LAMBDA_FUNCTION_VERSION=1
ENV AWS_LAMBDA_FUNCTION_MEMORY_SIZE=128
ENV LAMBDA_TASK_ROOT=/var/task
ENV OTEL_DEBUG_ENABLED=true

# Use AWS_LAMBDA_EXEC_WRAPPER to run our OTel initialization script
# This is the official AWS Lambda pattern for wrapping handlers
ENV AWS_LAMBDA_EXEC_WRAPPER=${LAMBDA_TASK_ROOT}/otel-handler

# Set the handler
CMD [ "handler.handler" ]
