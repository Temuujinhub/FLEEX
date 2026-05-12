import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'fleex:audit';

export interface AuditMeta {
  action: string;
  resourceType?: string;
  resourceIdParam?: string;
  captureResult?: boolean;
}

export const Audit = (action: string, opts: Omit<AuditMeta, 'action'> = {}) =>
  SetMetadata(AUDIT_KEY, { action, ...opts } satisfies AuditMeta);
