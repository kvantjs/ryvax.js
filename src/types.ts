import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { ReactNode } from 'react';
import type { LoggerOptions } from './logger.js';
import type { HealthRegistry, MetricsAdapter } from './platform.js';
import type { ProjectGraph } from './introspection.js';

export type Runtime = 'node' | 'edge';
export type RenderMode = 'ssr' | 'ssg' | 'api';

export interface RouteParams {
  [key: string]: string | string[];
}

/** Mutable request-scoped data shared by handlers and middleware. */
export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  /** Aborts when the client disconnects, the request times out, or the server shuts down. */
  signal: AbortSignal;
  url: URL;
  params: RouteParams;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: unknown;
  /** The unparsed request body, when a body was received. Useful for signed webhooks. */
  rawBody?: string;
  runtime: Runtime;
  state: Record<string, unknown>;
  env: Record<string, string | undefined>;
  method?: string;
  requestId?: string;
  /** Epoch milliseconds at which request work should be considered expired. */
  deadline?: number;
  timeoutMs?: number;
}

export type PageComponent<P = Record<string, unknown>> = (
  props: P,
  context: RequestContext,
) => ReactNode | Promise<ReactNode>;

export type LayoutComponent = (
  props: { children: ReactNode } & Record<string, unknown>,
  context: RequestContext,
) => ReactNode | Promise<ReactNode>;

export interface LayoutModule {
  default: LayoutComponent;
}

export type BoundaryComponent = (
  props: { error?: unknown; children?: ReactNode } & Record<string, unknown>,
  context: RequestContext,
) => ReactNode | Promise<ReactNode>;

export interface BoundaryModule {
  default: BoundaryComponent;
}

export interface PageModule<P = Record<string, unknown>> {
  default: PageComponent<P>;
  getServerSideProps?: (context: RequestContext) => P | Promise<P>;
  getStaticProps?: (context?: RequestContext) => P | Promise<P>;
  getStaticPaths?: () => RouteParams[] | Promise<RouteParams[]>;
  generateStaticParams?: () => RouteParams[] | Promise<RouteParams[]>;
  revalidate?: number;
  headers?: Record<string, string>;
}

export type ApiHandler = (context: RequestContext) => ResponseLike | Promise<ResponseLike>;

export interface ApiModule {
  default?: ApiHandler;
  GET?: ApiHandler;
  POST?: ApiHandler;
  PUT?: ApiHandler;
  PATCH?: ApiHandler;
  DELETE?: ApiHandler;
  OPTIONS?: ApiHandler;
  HEAD?: ApiHandler;
  middleware?: Middleware[];
}

export interface ResponseLike {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  react?: ReactNode;
  json?: unknown;
  redirect?: string;
  /** Async chunks are written until completion, abort, or client close. */
  stream?: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
  /** Optional signal for adapters that produce a stream outside RequestContext. */
  signal?: AbortSignal;
  /** Cache tags for an adapter or an observability integration. */
  tags?: string[];
}

export type NextHandler = () => ResponseLike | Promise<ResponseLike>;
export type Middleware = (context: RequestContext, next: NextHandler) => ResponseLike | Promise<ResponseLike>;

export interface RouteDefinition {
  id: string;
  kind: RenderMode;
  pathname: string;
  pattern: string;
  file: string;
  bundle: string;
  segments: string[];
  dynamic: boolean;
  catchAll: boolean;
  /** Bundled app layouts, ordered from the outermost to the innermost layout. */
  layouts?: string[];
  errorBoundary?: string;
  forbiddenBoundary?: string;
  unauthorizedBoundary?: string;
  loadingBoundary?: string;
  slots?: Record<string, string>;
}

export interface ManifestCapabilities {
  api: boolean;
  ssr: boolean;
  ssg: boolean;
  streaming: boolean;
  client: boolean;
}

export interface RouteManifest {
  generatedAt: string;
  routes: RouteDefinition[];
  graph?: ProjectGraph;
  runtime?: Runtime;
  capabilities?: ManifestCapabilities;
  outputDir?: string;
  client?: {
    entry: string;
  };
  notFound?: string;
  actions?: ActionDefinition[];
}

export interface ActionDefinition {
  id: string;
  name: string;
  bundle: string;
  exportName: string;
}

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  staleAt?: number;
  tags?: string[];
}

export interface CachePolicy {
  ttl?: number;
  staleWhileRevalidate?: number;
  tags?: string[];
  namespace?: string;
  version?: string;
}

export interface AppConfig {
  rootDir?: string;
  port?: number;
  host?: string;
  runtime?: Runtime;
  securityHeaders?: Record<string, string>;
  security?: { cspNonce?: string; trustedTypes?: boolean };
  poweredBy?: boolean;
  cache?: {
    enabled?: boolean;
    defaultTtl?: number;
    staleWhileRevalidate?: number;
    maxEntries?: number;
  };
  middleware?: Middleware[];
  env?: Record<string, string | undefined>;
  logging?: LoggerOptions;
  observability?: {
    requestId?: boolean;
    requestLogging?: boolean;
    metrics?: MetricsAdapter;
  };
  /** Enables JSON health and readiness endpoints when a registry is supplied. */
  health?: HealthRegistry;
  healthPath?: string;
  readinessPath?: string;
  limits?: {
    bodyBytes?: number;
    requestTimeoutMs?: number;
    shutdownTimeoutMs?: number;
    healthTimeoutMs?: number;
    actionBytes?: number;
    actionTimeoutMs?: number;
  };
  actions?: {
    enabled?: boolean;
    path?: string;
    allowedOrigins?: string[];
    csrf?: { header?: string; expectedToken?: string };
  };
  deploymentTarget?: string;
  plugins?: import('./plugins.js').RyvaxPlugin[];
}

export interface DatabaseAdapter {
  findMany<T = unknown>(table: string, query?: Record<string, unknown>): Promise<T[]>;
  findUnique<T = unknown>(table: string, query: Record<string, unknown>): Promise<T | null>;
  create<T = unknown>(table: string, data: Record<string, unknown>): Promise<T>;
  update<T = unknown>(table: string, where: Record<string, unknown>, data: Record<string, unknown>): Promise<T>;
  delete<T = unknown>(table: string, where: Record<string, unknown>): Promise<T>;
}

export interface BuildOptions {
  rootDir: string;
  outDir?: string;
  mode?: 'development' | 'production';
  runtime?: Runtime;
  sourcemap?: boolean;
  minify?: boolean;
  watch?: boolean;
  cacheBuilds?: boolean;
  builder?: 'auto' | 'esbuild' | 'rolldown';
  target?: 'node' | 'browser' | 'edge' | 'worker';
  profile?: boolean;
  plugins?: import('./plugins.js').RyvaxPlugin[];
}
