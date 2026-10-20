import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe, NgFor, NgIf, NgStyle } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
  IonButtons, IonBackButton, IonSpinner,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { inject, signal } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';
import { AuthService } from '../../core/services/auth.service';
import { SyncService } from '../../core/services/sync.service';
import { GUEST_MODE_KEY } from '../../core/guards/auth.guard';
import { Router } from '@angular/router';
import { OnboardingService } from '../onboarding/onboarding.service';

const PALETTES = [
  { id: 'default',   name: 'Emerald',   lightBg: '#ffffff', accent: '#2dd36f', darkBg: '#111713', darkAccent: '#62d98b' },
  { id: 'ocean',     name: 'Ocean',     lightBg: '#f0f9ff', accent: '#0ea5e9', darkBg: '#0b1420', darkAccent: '#38bdf8' },
  { id: 'sunset',    name: 'Sunset',    lightBg: '#fffbf0', accent: '#f97316', darkBg: '#1b120c', darkAccent: '#fb923c' },
  { id: 'forest',    name: 'Forest',    lightBg: '#f0fdf4', accent: '#16a34a', darkBg: '#0e1712', darkAccent: '#4ade80' },
  { id: 'amethyst',  name: 'Amethyst',  lightBg: '#faf5ff', accent: '#7c3aed', darkBg: '#171220', darkAccent: '#a78bfa' },
  { id: 'rose',      name: 'Rose',      lightBg: '#fff5f7', accent: '#e11d48', darkBg: '#1b1115', darkAccent: '#fb7185' },
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule, NgFor, NgIf, NgStyle, DatePipe,
    IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
    IonButtons, IonBackButton, IonSpinner,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .palette-section { padding: 8px 16px 16px; }
    .palette-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .palette-card {
      appearance: none;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: border-color 0.2s, transform 0.15s;
      font: inherit;
      background: var(--card-bg);
      color: var(--text-primary);
    }
    .palette-card:active { transform: scale(0.96); }
    .palette-card.palette-selected { border-color: var(--accent-green); }
    .palette-preview {
      display: flex;
      height: 56px;
    }
    .preview-half {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .preview-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .palette-name {
      text-align: center;
      font-size: 0.68rem;
      font-weight: 600;
      padding: 5px 4px 6px;
      color: var(--text-secondary);
      background: var(--card-bg);
      letter-spacing: 0.2px;
    }
    .palette-card.palette-selected .palette-name {
      color: var(--plan-accent-ink);
    }
    @media (min-width: 1024px) {
      .palette-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    }
    .sync-notice {
      padding: 12px 16px 0;
    }
    .sync-notice-content {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 4px 14px;
    }
    .sync-notice-icon {
      font-size: 1.6rem;
      line-height: 1;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .sync-notice-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .sync-notice-text strong {
      font-size: 0.88rem;
      color: var(--ion-text-color);
    }
    .sync-notice-text span {
      font-size: 0.78rem;
      color: var(--ion-color-medium);
      line-height: 1.4;
    }
    .sync-error-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(255, 73, 97, 0.12);
      border-left: 3px solid #ff4961;
    }
    .sync-error-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }
    .sync-error-text {
      font-size: 0.78rem;
      color: #ff4961;
      line-height: 1.4;
    }
  `],
})
export class SettingsComponent implements OnInit {
  readonly PALETTES = PALETTES;
  userName = 'User';
  theme = 'system';
  colorPalette = 'default';
  currencySymbol = '₱';
  currencyCode = 'PHP';
  isLoggedIn!: () => boolean;
  syncError!: () => string | null;
  lastCompactionAt!: () => string | null;
  syncWarningCount!: () => number;
  readonly syncing = signal(false);
  readonly deleting = signal(false);

  private readonly onboarding = inject(OnboardingService);

  /** Navigates home and replays the first-run walkthrough. */
  async replayWalkthrough(): Promise<void> {
    await this.router.navigateByUrl('/dashboard');
    this.onboarding.open();
  }

  constructor(
    private prefs: PreferencesService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router,
    private authService: AuthService,
    private syncService: SyncService,
  ) {
    this.isLoggedIn = this.authService.isLoggedIn;
    this.syncError = this.syncService.syncError;
    this.lastCompactionAt = this.syncService.lastCompactionAt;
    this.syncWarningCount = () => this.syncService.syncWarnings().length;
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.theme = await this.prefs.getTheme();
    this.currencySymbol = await this.prefs.getCurrencySymbol();
    this.currencyCode = await this.prefs.getCurrencyCode();
    this.colorPalette = await this.prefs.getPalette();
  }

  async changeName(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Change Name',
      inputs: [{ name: 'name', type: 'text', placeholder: 'Enter your name', value: this.userName }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            if (data.name?.trim()) {
              this.userName = data.name.trim();
              await this.prefs.setUserName(this.userName);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async changeTheme(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Choose Theme',
      inputs: [
        { type: 'radio', label: 'System', value: 'system', checked: this.theme === 'system' },
        { type: 'radio', label: 'Dark', value: 'dark', checked: this.theme === 'dark' },
        { type: 'radio', label: 'Light', value: 'light', checked: this.theme === 'light' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'OK',
          handler: async (value) => {
            this.theme = value;
            await this.prefs.setTheme(value);
            this.applyTheme(value);
          },
        },
      ],
    });
    await alert.present();
  }

  async changeCurrency(): Promise<void> {
    const currencies = [
      { symbol: '₱', code: 'PHP', label: '₱ PHP – Philippine Peso' },
      { symbol: '$', code: 'USD', label: '$ USD – US Dollar' },
      { symbol: '€', code: 'EUR', label: '€ EUR – Euro' },
      { symbol: '£', code: 'GBP', label: '£ GBP – British Pound' },
      { symbol: '¥', code: 'JPY', label: '¥ JPY – Japanese Yen' },
      { symbol: '₩', code: 'KRW', label: '₩ KRW – Korean Won' },
      { symbol: 'A$', code: 'AUD', label: 'A$ AUD – Australian Dollar' },
      { symbol: 'C$', code: 'CAD', label: 'C$ CAD – Canadian Dollar' },
    ];
    const alert = await this.alertCtrl.create({
      header: 'Choose Currency',
      inputs: currencies.map(c => ({
        type: 'radio' as const,
        label: c.label,
        value: c.code,
        checked: this.currencyCode === c.code,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'OK',
          handler: async (code: string) => {
            const selected = currencies.find(c => c.code === code);
            if (selected) {
              this.currencyCode = selected.code;
              this.currencySymbol = selected.symbol;
              await this.prefs.setCurrency(selected.symbol, selected.code);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  importData(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const json = e.target?.result as string;
          JSON.parse(json); // validate before importing
          const confirm = await this.alertCtrl.create({
            header: 'Import Data',
            message: 'This will merge imported data with your current records. Newer records win, invalid records are blocked in strict mode, and nothing is silently erased. Continue?',
            buttons: [
              { text: 'Cancel', role: 'cancel' },
              {
                text: 'Import',
                handler: async () => {
                  try {
                    const report = await this.prefs.importAllData(json);
                    const summary = await this.alertCtrl.create({
                      header: 'Import Complete',
                      message: `${report.importedCount} records processed, ${report.updatedCount} merged, ${report.warnings.length} warnings. Reload now to refresh the app state?`,
                      buttons: [
                        { text: 'Later', role: 'cancel' },
                        {
                          text: 'Reload',
                          handler: async () => {
                            window.location.reload();
                          },
                        },
                      ],
                    });
                    await summary.present();
                  } catch (err) {
                    const message = err instanceof Error
                      ? err.message
                      : 'Import was blocked by strict validation rules.';
                    const blocked = await this.alertCtrl.create({
                      header: 'Import Blocked',
                      message,
                      buttons: ['OK'],
                    });
                    await blocked.present();
                  }
                },
              },
            ],
          });
          await confirm.present();
        } catch {
          const alert = await this.alertCtrl.create({
            header: 'Invalid File',
            message: 'The selected file could not be imported safely.',
            buttons: ['OK'],
          });
          await alert.present();
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private applyTheme(theme: string): void {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('ion-palette-dark');
    } else if (theme === 'light') {
      html.classList.remove('ion-palette-dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.classList.toggle('ion-palette-dark', prefersDark);
    }
  }

  async selectPalette(id: string): Promise<void> {
    this.colorPalette = id;
    await this.prefs.setPalette(id);
    if (id === 'default') {
      document.documentElement.removeAttribute('data-palette');
    } else {
      document.documentElement.setAttribute('data-palette', id);
    }
  }

  async deleteAllData(): Promise<void> {
    if (this.deleting()) return;
    const alert = await this.alertCtrl.create({
      header: 'Delete All Data',
      message: 'This action cannot be undone. All your data will be permanently deleted.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete Everything', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.deleting.set(true);
    try {
      const uid = this.authService.currentUser()?.uid;
      if (uid) {
        await this.syncService.wipeFirestoreData(uid);
      }
      await this.prefs.clearAllData();
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Data could not be deleted. Please try again.';
      const failure = await this.alertCtrl.create({
        header: 'Delete Failed',
        message,
        buttons: ['OK'],
      });
      await failure.present();
    } finally {
      this.deleting.set(false);
    }
  }

  async manualSync(): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      await this.syncService.syncPendingWrites();
      const toast = await this.toastCtrl.create({
        message: 'Pending uploads are synced. Incoming changes sync automatically.',
        duration: 3000,
        color: 'success',
        position: 'bottom',
      });
      await toast.present();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed. Please try again.';
      const toast = await this.toastCtrl.create({
        message: msg,
        duration: 4000,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      this.syncing.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  async signIn(): Promise<void> {
    await this.router.navigate(['/login'], { replaceUrl: true });
  }

  async signOut(): Promise<void> {
    const confirmAlert = await this.alertCtrl.create({
      header: 'Sign Out',
      message: 'Are you sure you want to sign out? Local data on this device will be cleared.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign Out',
          role: 'destructive',
          handler: () => this._doSignOut(),
        },
      ],
    });
    await confirmAlert.present();
  }

  private async _doSignOut(): Promise<void> {
    await this.prefs.clearAllData();
    await this.authService.signOut();
    localStorage.removeItem(GUEST_MODE_KEY);
    // Hard navigate + reload so all in-memory Angular signals are reset.
    window.location.href = '/login';
  }
}
