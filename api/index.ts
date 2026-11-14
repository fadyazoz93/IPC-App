import type { Request, Response } from 'express';
import app, { ensureDbReady } from '../server';

function restoreOriginalApiUrl(req: Request): void {
  const rawUrl = req.url || '/';
  const [pathnamePart, searchPart = ''] = rawUrl.split('?');
  const params = new URLSearchParams(searchPart);
  const rewrittenPath = params.get('__path');

  if (rewrittenPath) {
    params.delete('__path');
    const cleanPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    const remainingSearch = params.toString();
    req.url = remainingSearch ? `${cleanPath}?${remainingSearch}` : cleanPath;
    return;
  }

  if (pathnamePart === '/api/index' || pathnamePart === '/api') {
    const headerPath =
      (req.headers['x-vercel-original-path'] as string | undefined) ||
      (req.headers['x-invoke-path'] as string | undefined) ||
      (req.headers['x-matched-path'] as string | undefined);
    if (headerPath && headerPath.startsWith('/api/') && headerPath !== '/api/index') {
      req.url = searchPart ? `${headerPath}?${searchPart}` : headerPath;
    }
  }
}

export default async function handler(req: Request, res: Response) {
  try {
    restoreOriginalApiUrl(req);
    await ensureDbReady();
    return app(req, res);
  } catch (err) {
    console.error('Vercel API handler initialization error:', err);
    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : 'تعذر الاتصال بقاعدة البيانات أو تهيئة الخادم.';
      res.status(500).json({ error: msg });
    }
  }
}
