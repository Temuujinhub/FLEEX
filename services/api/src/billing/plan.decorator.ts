import { SetMetadata } from '@nestjs/common';

// Marks a handler (or controller) as requiring the "all reports" plan tier
// (Business+). PlanGuard reads this and blocks managed `basic` (Starter)
// tenants. SUPER_ADMIN and unmanaged/grandfathered tenants always pass.
export const REQUIRES_ALL_REPORTS = 'fleex:requiresAllReports';
export const RequiresAllReports = () => SetMetadata(REQUIRES_ALL_REPORTS, true);
