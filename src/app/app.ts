import { Component, OnInit, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { PreferencesService } from './core/services/preferences.service';
import { NotificationService } from './core/services/notification.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App implements OnInit {
  private prefs = inject(PreferencesService);
  private notifications = inject(NotificationService);

  async ngOnInit(): Promise<void> {
    const theme = await this.prefs.getTheme();
    this.applyTheme(theme);
    await this.notifications.init();
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
}
