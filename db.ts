import type { Client, InValue, ResultSet, Transaction } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const rawUrl = (
  process.env.TURSO_DATABASE_URL ||
  process.env.LIBSQL_URL ||
  process.env.DATABASE_URL ||
  ''
).trim();

const rawAuthToken = (
  process.env.TURSO_AUTH_TOKEN ||
  process.env.LIBSQL_AUTH_TOKEN ||
  process.env.TURSO_TOKEN ||
  ''
).trim();

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const isTursoRemote = Boolean(rawUrl && !rawUrl.startsWith('file:'));
const effectiveUrl = rawUrl || (isVercel ? 'file:/tmp/portal.db' : 'file:portal.db');

function maskDatabaseUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('file:')) return url;
  try {
    const normalized = url.replace(/^libsql:\/\//i, 'https://');
    const parsed = new URL(normalized);
    const proto = url.split('://')[0] || 'libsql';
    return `${proto}://${parsed.host}`;
  } catch {
    return url.slice(0, 32) + (url.length > 32 ? '...' : '');
  }
}

export const dbMeta = {
  provider: isTursoRemote ? ('turso' as const) : ('local_sqlite' as const),
  isTursoRemote,
  isVercel,
  databaseUrlMasked: maskDatabaseUrl(effectiveUrl),
  hasDatabaseUrlEnv: Boolean(rawUrl),
  hasAuthToken: Boolean(rawAuthToken),
};

let clientPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (isTursoRemote) {
        // Use the pure JS/HTTP web client for remote Turso so serverless environments (Vercel)
        // never depend on native libsql C++ bindings or WebSocket upgrades.
        const { createClient } = await import('@libsql/client/web');
        return createClient({
          url: effectiveUrl,
          authToken: rawAuthToken || undefined,
        });
      }
      const { createClient } = await import('@libsql/client');
      return createClient({
        url: effectiveUrl,
      });
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export interface DbExecutor {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: bigint }>;
  exec(sql: string): Promise<void>;
  batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<void>;
}

function normalizeArgs(params?: unknown[]): InValue[] {
  if (!params || params.length === 0) return [];
  return params.map((p) => (p === undefined ? null : (p as InValue)));
}

function mapRows<T>(res: ResultSet): T[] {
  if (!res.rows || res.rows.length === 0) return [];
  const cols = res.columns || [];
  return res.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      obj[col] = row[col] !== undefined ? row[col] : row[i];
    }
    return obj as T;
  });
}

function createExecutor(
  getTarget: () => Promise<Client | Transaction>,
  isTx = false
): DbExecutor {
  return {
    async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
      const target = await getTarget();
      const res = await target.execute({ sql, args: normalizeArgs(params) });
      const rows = mapRows<T>(res);
      return rows[0];
    },
    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const target = await getTarget();
      const res = await target.execute({ sql, args: normalizeArgs(params) });
      return mapRows<T>(res);
    },
    async run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: bigint }> {
      const target = await getTarget();
      const res = await target.execute({ sql, args: normalizeArgs(params) });
      return {
        changes: Number(res.rowsAffected || 0),
        lastInsertRowid: res.lastInsertRowid,
      };
    },
    async exec(sql: string): Promise<void> {
      const target = await getTarget();
      if ('executeMultiple' in target && typeof target.executeMultiple === 'function') {
        await target.executeMultiple(sql);
        return;
      }
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statements.length === 0) return;

      if (!isTx && 'batch' in target && typeof (target as Client).batch === 'function') {
        await (target as Client).batch(
          statements.map((stmt) => ({ sql: stmt, args: [] })),
          'write'
        );
      } else if (isTx && 'batch' in target && typeof (target as Transaction).batch === 'function') {
        await (target as Transaction).batch(statements.map((stmt) => ({ sql: stmt, args: [] })));
      } else {
        for (const stmt of statements) {
          await target.execute(stmt);
        }
      }
    },
    async batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<void> {
      if (statements.length === 0) return;
      const target = await getTarget();
      const formatted = statements.map((s) => ({ sql: s.sql, args: normalizeArgs(s.args) }));
      if (!isTx && 'batch' in target && typeof (target as Client).batch === 'function') {
        await (target as Client).batch(formatted, 'write');
      } else if (isTx && 'batch' in target && typeof (target as Transaction).batch === 'function') {
        await (target as Transaction).batch(formatted);
      } else {
        for (const s of formatted) {
          await target.execute(s);
        }
      }
    },
  };
}

const baseExecutor = createExecutor(() => getClient(), false);

export const db: DbExecutor & {
  transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  ping: () => Promise<number>;
} = {
  ...baseExecutor,
  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const client = await getClient();
    const tx = await client.transaction('write');
    const txExecutor = createExecutor(async () => tx, true);
    try {
      const result = await fn(txExecutor);
      await tx.commit();
      return result;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      tx.close();
    }
  },
  async ping(): Promise<number> {
    const start = Date.now();
    const client = await getClient();
    await client.execute('SELECT 1');
    return Date.now() - start;
  },
};
