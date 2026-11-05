import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Request } from 'express';
import { IS_PUBLIC } from './public.decorator.js';

const SSE_PATH = /\/events\/stream$/;

/**
 * Global guard: every route needs a valid Cognito access token unless marked
 * @Public() or AUTH_DISABLED=true (local dev only; refused in production).
 */
@Injectable()
export class CognitoAuthGuard implements CanActivate {
  private readonly logger = new Logger(CognitoAuthGuard.name);
  private readonly disabled: boolean;
  private readonly verifier?: { verify(token: string): Promise<unknown> };

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.disabled = config.get<boolean>('auth.disabled') ?? false;
    if (this.disabled) {
      this.logger.warn(
        'Auth is DISABLED (AUTH_DISABLED=true). Local development only.',
      );
      return;
    }
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: config.getOrThrow<string>('auth.cognitoUserPoolId'),
      clientId: config.getOrThrow<string>('auth.cognitoClientId'),
      tokenUse: 'access',
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || this.disabled) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing access token');
    try {
      (req as Request & { user?: unknown }).user =
        await this.verifier!.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // EventSource can't set headers; allow a query token on the SSE route only.
    if (SSE_PATH.test(req.path) && typeof req.query.access_token === 'string')
      return req.query.access_token;
    return undefined;
  }
}
