import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from './session.service';

/** Route-level equivalent of the React nav `visible(roles)` filter. */
export const roleGuard: CanActivateFn = (route) => {
  const roles = (route.data['roles'] as string[] | undefined) ?? [];
  const session = inject(SessionService);
  const router = inject(Router);
  const user = session.getUser();

  if (!roles.length) return true;
  if (user && roles.includes(user.role)) return true;
  return router.createUrlTree([user ? '/' : '/login']);
};
