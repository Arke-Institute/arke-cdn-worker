import type { Context } from 'hono';

export function handleHealth(c: Context) {
  return c.json({
    service: 'arke-cdn-worker',
    status: 'healthy',
    version: '2.0.0',
    features: ['variants', 'r2', 'url-storage']
  });
}
