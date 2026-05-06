import { Component, OnInit, inject, effect } from '@angular/core';
import { IonApp, IonRouterOutlet, ToastController } from '@ionic/angular/standalone';
import { PreferencesService } from './core/services/preferences.service';
import { NotificationService } from './core/services/notification.service';
import { SyncService } from './core/services/sync.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App implements OnInit {
  private prefs = inject(PreferencesService);
  private notifications = inject(NotificationService);
  private syncService = inject(SyncService);
  private toastCtrl = inject(ToastController);

  constructor() {
    // Watch for background sync failures and surface a non-intrusive toast.
    effect(() => {
      const err = this.syncService.syncError();
      if (err) {
        this.toastCtrl
          .create({
            message: `☁️ Cloud sync failed: ${err}`,
            duration: 5000,
            color: 'warning',
            position: 'bottom',
            buttons: [{ text: 'Dismiss', role: 'cancel' }],
          })
          .then(t => t.present());
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const theme = await this.prefs.getTheme();
    this.applyTheme(theme);
    const palette = await this.prefs.getPalette();
    this.applyPalette(palette);
    this.notifications.init().catch(() => {});
  }

  private applyTheme(theme: string): void {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('ion-palette-dark');
    } else if (theme === 'light') {
      html.classList.remove('ion-palette-dark');
    } else {
      // System preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.classList.toggle('ion-palette-dark', prefersDark);
    }
  }

  private applyPalette(palette: string): void {
    if (palette === 'default') {
      document.documentElement.removeAttribute('data-palette');
    } else {
      document.documentElement.setAttribute('data-palette', palette);
    }
  }
}
