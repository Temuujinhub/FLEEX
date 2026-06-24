import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantStore } from './tenant-context';

// Runs after the auth guards (so req.user is populated) and establishes the
// request-scoped tenant context for the rest of the handler — including any
// Prisma queries it makes, since AsyncLocalStorage propagates across awaits.
// The Prisma tenant-guard middleware reads this context. WebSocket and other
// non-HTTP contexts authenticate separately and are left untouched.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user) return next.handle();

    return new Observable((subscriber) => {
      tenantStore.run({ companyId: user.companyId ?? null, role: user.role }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
