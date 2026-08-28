import type { IncomingMessage, ServerResponse } from 'node:http';

export type ControlRouteRegistryErrorCode =
  | 'CONTROL_ROUTE_INVALID'
  | 'CONTROL_ROUTE_DUPLICATE'
  | 'CONTROL_ROUTE_FROZEN'
  | 'CONTROL_ROUTE_CONTRACT';

export class ControlRouteRegistryError extends Error {
  constructor(readonly code: ControlRouteRegistryErrorCode) {
    super(code);
    this.name = 'ControlRouteRegistryError';
  }
}

export type ControlRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export interface FrozenControlRouteExtension {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

interface RegisteredControlRoute {
  prefix: string;
  handler: ControlRouteHandler;
}

const validPrefix = (prefix: string): boolean =>
  /^\/control\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(prefix);

const matchesPrefix = (url: string | undefined, prefix: string): boolean =>
  url === prefix || url?.startsWith(`${prefix}/`) === true;

export class ControlRouteRegistry {
  private route: RegisteredControlRoute | undefined;
  private frozen: FrozenControlRouteExtension | undefined;

  register(prefix: string, handler: ControlRouteHandler): void {
    if (this.frozen !== undefined) throw new ControlRouteRegistryError('CONTROL_ROUTE_FROZEN');
    if (!validPrefix(prefix) || typeof handler !== 'function') {
      throw new ControlRouteRegistryError('CONTROL_ROUTE_INVALID');
    }
    if (this.route !== undefined) throw new ControlRouteRegistryError('CONTROL_ROUTE_DUPLICATE');
    this.route = { prefix, handler };
  }

  freeze(): FrozenControlRouteExtension {
    if (this.frozen !== undefined) return this.frozen;
    const route = this.route;
    this.frozen = Object.freeze({
      handle: async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
        if (route === undefined || !matchesPrefix(req.url, route.prefix)) return false;
        const handled = await route.handler(req, res);
        if (handled === true) {
          if (!res.headersSent && !res.writableEnded) {
            throw new ControlRouteRegistryError('CONTROL_ROUTE_CONTRACT');
          }
          return true;
        }
        if (handled === false) {
          if (res.headersSent || res.writableEnded) {
            res.destroy();
            throw new ControlRouteRegistryError('CONTROL_ROUTE_CONTRACT');
          }
          return false;
        }
        throw new ControlRouteRegistryError('CONTROL_ROUTE_CONTRACT');
      },
    });
    return this.frozen;
  }
}
