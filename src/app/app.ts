import { Component, DestroyRef, OnInit, inject, effect, ChangeDetectionStrategy } from '@angular/core';
import { IonApp, IonRouterOutlet, AlertController, ToastController } from '@ionic/angular/standalone';
import { App as CapacitorApp } from '@capacitor/app';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { PreferencesService } from './core/services/preferences.service';
import { NotificationService } from './core/services/notification.service';
import { SyncService } from './core/services/sync.service';
import { GoogleWalletCaptureService } from './core/services/google-wallet-capture.service';
import { PendingNotificationQueueService } from './core/services/pending-notification-queue.service';
import { PendingNotificationCandidate } from './core/models';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App implements OnInit {
  private prefs = inject(PreferencesService);
  private notifications = inject(NotificationService);
  private syncService = inject(SyncService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private walletCapture = inject(GoogleWalletCaptureService);
  private pendingQueue = inject(PendingNotificationQueueService);
  private readonly walletReviewQueue: PendingNotificationCandidate[] = [];
  private readonly queuedCandidateIds = new Set<string>();
  private isWalletAlertOpen = false;
  private isExpenseConfirmationOpen = false;
  private isAppActive = true;

  constructor() {
    this.pendingQueue.candidateAdded$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(candidate => this.queueWalletReview(candidate));
    this.pendingQueue.expenseReviewFinished$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.isExpenseConfirmationOpen = false;
        void this.showNextWalletReview();
      });
    void CapacitorApp.addListener('appStateChange', state => {
      this.isAppActive = state.isActive;
      if (state.isActive) void this.showNextWalletReview();
    })
      .then(handle => this.destroyRef.onDestroy(() => void handle.remove()))
      .catch(error => {
        void this.showToast(
          error instanceof Error ? error.message : 'Could not monitor app notification state.',
          'warning'
        );
      });

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
    void this.walletCapture.initialize().catch(error => {
      void this.showToast(
        error instanceof Error ? error.message : 'Could not start bank and e-wallet notification capture.',
        'warning'
      );
    });
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

  private queueWalletReview(candidate: PendingNotificationCandidate): void {
    if (this.queuedCandidateIds.has(candidate.id)) return;
    this.queuedCandidateIds.add(candidate.id);
    this.walletReviewQueue.push(candidate);
    void this.showNextWalletReview();
  }

  private async showNextWalletReview(): Promise<void> {
    if (!this.isAppActive || this.isWalletAlertOpen || this.isExpenseConfirmationOpen) return;
    const candidate = this.walletReviewQueue.shift();
    if (!candidate) return;
    this.queuedCandidateIds.delete(candidate.id);
    if (!this.pendingQueue.pendingCandidates().some(item => item.id === candidate.id)) {
      void this.showNextWalletReview();
      return;
    }

    this.isWalletAlertOpen = true;
    try {
      const alert = await this.alertCtrl.create({
        header: 'transaction',
        message: this.walletReviewMessage(candidate),
        buttons: [
          { text: 'Review later', role: 'cancel' },
          { text: 'Add to expenses', role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      this.isWalletAlertOpen = false;
      if (role === 'confirm') {
        this.isExpenseConfirmationOpen = true;
        this.pendingQueue.requestExpenseReview(candidate.id, this.currentReturnUrl());
        try {
          const navigated = await this.router.navigateByUrl('/expenses');
          if (!navigated) {
            this.pendingQueue.cancelExpenseReviewRequest(candidate.id);
            this.isExpenseConfirmationOpen = false;
            await this.showToast('Could not open Expenses to record this purchase.', 'danger');
          }
        } catch (error) {
          this.pendingQueue.cancelExpenseReviewRequest(candidate.id);
          this.isExpenseConfirmationOpen = false;
          await this.showToast(
            error instanceof Error ? error.message : 'Could not open Expenses to record this purchase.',
            'danger'
          );
        }
      }
    } catch (error) {
      this.isWalletAlertOpen = false;
      await this.showToast(
        error instanceof Error ? error.message : 'Could not show the transaction review.',
        'danger'
      );
    }
  }

  /** The route the user is on, unless it is Expenses itself (nothing to return to). */
  private currentReturnUrl(): string | null {
    const url = this.router.url;
    return url === '/expenses' || url.startsWith('/expenses?') ? null : url;
  }

  private walletReviewMessage(candidate: PendingNotificationCandidate): string {
    const merchant = candidate.merchantName || 'Unknown merchant';
    if (candidate.amount === null) return `${merchant}. Amount needs to be confirmed.`;
    const currency = candidate.currency || 'PHP';
    try {
      const amount = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
      }).format(candidate.amount);
      return `${merchant} · ${amount}`;
    } catch {
      return `${merchant} · ${candidate.amount} ${currency}`;
    }
  }

  private async showToast(message: string, color: 'warning' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 4000,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
