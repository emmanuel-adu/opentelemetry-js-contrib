import { Span, Context as OtelContext } from '@opentelemetry/api';
import { Context } from 'aws-lambda';

export type RequestHook = (
  span: Span,
  info: { event: any; context: Context }
) => void;

export type ResponseHook = (
  span: Span,
  info: { err?: Error | string | null; res?: any }
) => void;

export interface AwsLambdaInstrumentationConfig {
  lambdaHandler?: string;
  lambdaStartTime?: number;
  requestHook?: RequestHook;
  responseHook?: ResponseHook;
  eventContextExtractor?: EventContextExtractor;
  enabled?: boolean;
  version?: string;
}

export type EventContextExtractor = (
  event: any,
  context: Context
) => OtelContext;
