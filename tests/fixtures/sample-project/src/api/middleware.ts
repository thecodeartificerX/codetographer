import { UserRepository } from '../models/user.js';
import { sanitizeInput } from '../utils/helpers.js';

export interface Request {
  headers: Record<string, string>;
  body: unknown;
  userId?: string;
}

export interface Response {
  status: number;
  body: unknown;
}

export type Handler = (req: Request) => Promise<Response>;
export type Middleware = (req: Request, next: Handler) => Promise<Response>;

export function authMiddleware(userRepo: UserRepository): Middleware {
  return async (req, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
    // Simple token = userId lookup (not real JWT)
    const user = userRepo.findById(token);
    if (!user) {
      return { status: 401, body: { error: 'Invalid token' } };
    }
    req.userId = user.id;
    return next(req);
  };
}

export function loggingMiddleware(): Middleware {
  return async (req, next) => {
    const start = Date.now();
    const res = await next(req);
    const ms = Date.now() - start;
    process.stderr.write(`[${new Date().toISOString()}] ${res.status} ${ms}ms\n`);
    return res;
  };
}
