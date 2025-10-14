import { Span, Context as OtelContext } from '@opentelemetry/api';
import { Context } from 'aws-lambda';

export interface AwsLambdaInstrumentationConfig {
  lambdaHandler?: string;
  lambdaStartTime?: number;
  requestHook?: (span: Span, info: { event: any; context: Context }) => void;
  responseHook?: (
    span: Span,
    info: { err?: Error | string | null; res?: any }
  ) => void;
  eventContextExtractor?: EventContextExtractor;
  enabled?: boolean;
  version?: string;
}

export type EventContextExtractor = (
  event: any,
  context: Context
) => OtelContext;

