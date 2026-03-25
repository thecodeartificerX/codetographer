import { UserRepository } from '../models/user.js';
import { authMiddleware, loggingMiddleware } from './middleware.js';
import { formatUserResponse, validateEmail, sanitizeInput } from '../utils/helpers.js';
import type { Handler, Middleware, Request, Response } from './middleware.js';

export class Server {
  private repo: UserRepository;
  private middlewares: Middleware[];

  constructor() {
    this.repo = new UserRepository();
    this.middlewares = [
      loggingMiddleware(),
      authMiddleware(this.repo),
    ];
  }

  async handleCreateUser(req: Request): Promise<Response> {
    const body = req.body as Record<string, string>;
    const email = sanitizeInput(body['email'] ?? '');
    const name = sanitizeInput(body['name'] ?? '');

    if (!validateEmail(email)) {
      return { status: 400, body: { error: 'Invalid email' } };
    }

    if (this.repo.findByEmail(email)) {
      return { status: 409, body: { error: 'Email already taken' } };
    }

    const user = this.repo.create({ email, name });
    return { status: 201, body: formatUserResponse(user) };
  }

  async handleGetUser(req: Request): Promise<Response> {
    const userId = req.userId;
    if (!userId) return { status: 401, body: { error: 'Unauthorized' } };

    const user = this.repo.findById(userId);
    if (!user) return { status: 404, body: { error: 'User not found' } };

    return { status: 200, body: formatUserResponse(user) };
  }

  async dispatch(path: string, req: Request): Promise<Response> {
    let handler: Handler;

    if (path === '/users' && req.headers['method'] === 'POST') {
      handler = (r) => this.handleCreateUser(r);
    } else if (path === '/me') {
      const composed = this.middlewares.reduceRight<Handler>(
        (next, mw) => (r) => mw(r, next),
        (r) => this.handleGetUser(r)
      );
      handler = composed;
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }

    return handler(req);
  }
}
