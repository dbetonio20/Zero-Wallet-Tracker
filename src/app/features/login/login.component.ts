import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';
import {
  IonContent,
  IonButton,
  IonSpinner,
  IonIcon,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { logoGoogle } from 'ionicons/icons';

import { AuthService } from '../../core/services/auth.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { GUEST_MODE_KEY } from '../../core/guards/auth.guard';

/** localStorage key tracking the UID of the last signed-in account. */
const LAST_AUTH_UID_KEY = 'last_auth_uid';

/** Native plugin error codes / messages that mean the user cancelled. */
const CANCEL_PATTERNS = ['cancel', 'cancelled', 'dismissed', '12501'];

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

  private static readonly DEFAULT_USER_NAME = 'User';

  constructor(
    private readonly authService: AuthService,
    private readonly prefs: PreferencesService,
    private readonly router: Router,
    private readonly toastCtrl: ToastController
  ) {
    addIcons({ logoGoogle });
  }

  /**
   * Simple sign-in: Google auth only. No Firestore checks during sign-in.
   * All data sync (push/pull) happens on the dashboard after the user is logged in.
   */
  async signInWithGoogle(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      await this.authService.signInWithGoogle();

      const user = this.authService.currentUser();
      if (!user) throw new Error('Authentication completed but no user was returned.');
      const uid = user.uid;

      const prevUid = localStorage.getItem(LAST_AUTH_UID_KEY);
      const isAccountSwitch = !!prevUid && prevUid !== uid;

      // Account switch: clear the previous account's local data before logging in to the new one.
      if (isAccountSwitch) {
        await this.prefs.clearAllData();
      }

      const profileName = this.getGoogleProfileName(user.displayName, user.email);
      const storedName = await this.prefs.getUserName();
      if (
        profileName &&
        (isAccountSwitch || !storedName.trim() || storedName === LoginComponent.DEFAULT_USER_NAME)
      ) {
        await this.prefs.setUserName(profileName);
      }

      localStorage.setItem(LAST_AUTH_UID_KEY, uid);

      // Navigate immediately. Firestore sync happens silently on the dashboard.
      await this.router.navigate(['/dashboard'], { replaceUrl: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isCancelled = CANCEL_PATTERNS.some(p => raw.toLowerCase().includes(p));

      if (!isCancelled) {
        const toast = await this.toastCtrl.create({
          message: raw || 'Sign-in failed. Please try again.',
          duration: 4000,
          color: 'danger',
          position: 'bottom',
        });
        await toast.present();
      }
    } finally {
      this.loading.set(false);
    }
  }

  continueAsGuest(): void {
    localStorage.setItem(GUEST_MODE_KEY, '1');
    this.router.navigate(['/dashboard'], { replaceUrl: true });
  }

  private getGoogleProfileName(displayName: string | null, email: string | null): string | null {
    const normalizedDisplayName = displayName?.trim();
    if (normalizedDisplayName) {
      return normalizedDisplayName;
    }

    const emailPrefix = email?.split('@')[0]?.trim();
    return emailPrefix || null;
  }
}
