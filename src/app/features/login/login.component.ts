import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';
import {
  IonContent,
  IonButton,
  IonSpinner,
  IonIcon,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { logoGoogle } from 'ionicons/icons';

import { AuthService } from '../../core/services/auth.service';
import { SyncService } from '../../core/services/sync.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { GUEST_MODE_KEY } from '../../core/guards/auth.guard';

/** localStorage key tracking the UID of the last signed-in account. */
const LAST_AUTH_UID_KEY = 'last_auth_uid';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, IonContent, IonButton, IonSpinner, IonIcon],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  readonly loading = signal(false);

  constructor(
    private readonly authService: AuthService,
    private readonly syncService: SyncService,
    private readonly prefs: PreferencesService,
    private readonly router: Router,
    private readonly alertCtrl: AlertController,
    private readonly toastCtrl: ToastController
  ) {
    addIcons({ logoGoogle });
  }

  async signInWithGoogle(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      await this.authService.signInWithGoogle();
      const uid = this.authService.currentUser()!.uid;

      const prevUid = localStorage.getItem(LAST_AUTH_UID_KEY);
      const isAccountSwitch = !!prevUid && prevUid !== uid;

      // Account switch: silently clear the previous account's local data before loading this one.
      if (isAccountSwitch) {
        await this.prefs.clearAllData();
      }

      localStorage.setItem(LAST_AUTH_UID_KEY, uid);

      const cloudHasData = await this.syncService.checkCloudHasData(uid);

      if (cloudHasData) {
        // Cloud data exists — pull it down and reload to apply it.
        await this.router.navigate(['/dashboard'], { replaceUrl: true });
        this.syncService.pullAll(uid)
          .then(() => window.location.reload())
          .catch(err => console.warn('[Login] pull failed', err));
        return;
      }

      // No cloud data. If this is NOT an account switch and local data exists,
      // ask the user whether to upload it or start fresh.
      if (!isAccountSwitch && (await this.syncService.checkLocalHasData())) {
        await this._askUploadOrStartFresh(uid);
        return;
      }

      // No local data and no cloud data — push (empty) collections to initialise the account.
      await this.syncService.pushAll(uid);
      await this.router.navigate(['/dashboard'], { replaceUrl: true });

    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      const toast = await this.toastCtrl.create({
        message,
        duration: 3500,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      this.loading.set(false);
    }
  }

  continueAsGuest(): void {
    localStorage.setItem(GUEST_MODE_KEY, '1');
    this.router.navigate(['/dashboard'], { replaceUrl: true });
  }

  /**
   * Shown when a user signs in for the first time and already has local data.
   * Lets them choose: upload that data to their Google account, or start fresh.
   */
  private async _askUploadOrStartFresh(uid: string): Promise<void> {
    return new Promise(resolve => {
      this.alertCtrl
        .create({
          header: 'You have local data',
          message:
            'Upload your existing data to your Google account, or start fresh with cloud sync?',
          backdropDismiss: false,
          buttons: [
            {
              text: 'Upload My Data',
              handler: () => {
                this.syncService
                  .pushAll(uid)
                  .catch(err => console.warn('[Login] push failed', err))
                  .finally(() => {
                    this.router.navigate(['/dashboard'], { replaceUrl: true });
                    resolve();
                  });
              },
            },
            {
              text: 'Start Fresh',
              role: 'destructive',
              handler: () => {
                this.router.navigate(['/dashboard'], { replaceUrl: true });
                resolve();
              },
            },
          ],
        })
        .then(alert => alert.present());
    });
  }
}
