import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const GUEST_MODE_KEY = 'salapi_guest_mode';

/**
 * Functional route guard — redirects to /login only if the user is neither
 * signed in nor has previously chosen to continue as a guest.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn() || localStorage.getItem(GUEST_MODE_KEY) === '1') {
    return true;
  }
  return router.createUrlTree(['/login']);
};
