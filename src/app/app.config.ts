import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { Storage } from '@ionic/storage-angular';

import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { SyncService } from './core/services/sync.service';

/**
 * APP_INITIALIZER factory that:
 * 1. Constructs SyncService eagerly so its storage callback is registered
 *    before any component writes data.
 * 2. Waits for Firebase to restore the persisted auth session before any
 *    route guard evaluates.
 */
function initApp(authService: AuthService, _syncService: SyncService): () => Promise<void> {
  return () => authService.init();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideIonicAngular({ mode: 'md' }),
    Storage,
    {
      provide: APP_INITIALIZER,
      useFactory: initApp,
      deps: [AuthService, SyncService],
      multi: true,
    },
  ]
};
