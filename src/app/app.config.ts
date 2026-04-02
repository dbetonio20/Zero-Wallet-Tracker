import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { Storage } from '@ionic/storage-angular';

import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
// SyncService is eagerly instantiated here so it registers its storage callback
// before any component writes data.
import { SyncService } from './core/services/sync.service';

function initAuth(authService: AuthService): () => Promise<void> {
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
      useFactory: initAuth,
      deps: [AuthService],
      multi: true,
    },
    // Eagerly instantiate SyncService so it registers its storage callback early.
    { provide: SyncService, useClass: SyncService },
  ]
};
