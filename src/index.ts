import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleHealth } from './handlers/health';
import { handleRegistration } from './handlers/registration';
import { handleRetrieval } from './handlers/retrieval';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', cors());

// Health check
app.get('/', handleHealth);

// Asset registration
app.post('/asset/:assetId', handleRegistration);

// Asset retrieval (handles both /asset/:assetId and /asset/:assetId/*)
app.get('/asset/:assetId', (c) => handleRetrieval(c));
app.get('/asset/:assetId/:path{.*}', (c) => handleRetrieval(c));

export default app;
