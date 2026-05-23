import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditMeta } from './audit.decorator';

// Auto-audits every controller method annotated with @Audit('action').
// Captures actor (from JWT), IP, user-agent, outcome and any body/params
// metadata helpful for later forensics.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const actor = req.user;
    const resourceId = meta.resourceIdParam ? req.params?.[meta.resourceIdParam] : undefined;

    const base = {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      companyId: actor?.companyId ?? null,
      action: meta.action,
      resourceType: meta.resourceType ?? null,
      resourceId: resourceId ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      metadata: { method: req.method, path: req.originalUrl ?? req.url } as Record<string, unknown>,
    };

    return next.handle().pipe(
      tap((result) => {
        // Best-effort: don't block the response on audit writes.
        this.audit
          .record({ ...base, after: meta.captureResult ? sanitize(result) : undefined, outcome: 'success' })
          .catch((err) => this.logger.warn(`audit error: ${(err as Error).message}`));
      }),
      catchError((err) => {
        const outcome: 'denied' | 'failure' = err?.status === 403 ? 'denied' : 'failure';
        this.audit
          .record({ ...base, metadata: { ...base.metadata, error: err?.message ?? String(err) }, outcome })
          .catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}

// Strip sensitive fields before audit storage.
function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const SENSITIVE = new Set(['password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'mfaSecret']);
  const clone = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown>) };
  for (const k of Object.keys(clone)) {
    if (SENSITIVE.has(k)) (clone as Record<string, unknown>)[k] = '[redacted]';
    else if (typeof (clone as Record<string, unknown>)[k] === 'object') {
      (clone as Record<string, unknown>)[k] = sanitize((clone as Record<string, unknown>)[k]);
    }
  }
  return clone;
}
