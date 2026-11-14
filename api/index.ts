import type { Request, Response } from 'express';
import app, { ensureDbReady } from '../server';

export default async function handler(req: Request, res: Response) {
  await ensureDbReady();
  return app(req, res);
}
