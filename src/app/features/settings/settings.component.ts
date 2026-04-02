import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf, NgStyle } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
  IonButtons, IonBackButton,
  AlertController,
} from '@ionic/angular/standalone';
import { PreferencesService } from '../../core/services/preferences.service';
import { AiService } from '../../core/services/ai.service';
import { AuthService } from '../../core/services/auth.service';
import { SyncService } from '../../core/services/sync.service';
import { GUEST_MODE_KEY } from '../../core/guards/auth.guard';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const PALETTES = [
  { id: 'default',   name: 'Emerald',   lightBg: '#ffffff', accent: '#2dd36f', darkBg: '#121212', darkAccent: '#2dd36f' },
  { id: 'ocean',     name: 'Ocean',     lightBg: '#f0f9ff', accent: '#0ea5e9', darkBg: '#0a1628', darkAccent: '#38bdf8' },
  { id: 'sunset',    name: 'Sunset',    lightBg: '#fffbf0', accent: '#f97316', darkBg: '#1c0f05', darkAccent: '#fb923c' },
  { id: 'forest',    name: 'Forest',    lightBg: '#f0fdf4', accent: '#16a34a', darkBg: '#052e16', darkAccent: '#4ade80' },
  { id: 'amethyst',  name: 'Amethyst',  lightBg: '#faf5ff', accent: '#7c3aed', darkBg: '#1e0a3c', darkAccent: '#a78bfa' },
  { id: 'rose',      name: 'Rose',      lightBg: '#fff5f7', accent: '#e11d48', darkBg: '#1a0a0d', darkAccent: '#fb7185' },
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule, NgFor, NgIf, NgStyle,
    IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
    IonButtons, IonBackButton,
  ],
  templateUrl: './settings.component.html',
  styles: [`
    .palette-section { padding: 8px 16px 16px; }
    .palette-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .palette-card {
      border-radius: 14px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: border-color 0.2s, transform 0.15s;
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
      color: var(--accent-green);
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

  constructor(
    private prefs: PreferencesService,
    private alertCtrl: AlertController,
    private router: Router,
    private ai: AiService,
    private authService: AuthService,
    private syncService: SyncService,
  ) {
    this.isLoggedIn = this.authService.isLoggedIn;
    this.syncError = this.syncService.syncError;
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
            message: 'This will overwrite all existing data with the backup. Continue?',
            buttons: [
              { text: 'Cancel', role: 'cancel' },
              {
                text: 'Import',
                handler: async () => {
                  await this.prefs.importAllData(json);
                  // Shut down the native AI plugin cleanly before reload to
                  // prevent MediaPipe double-init crash on next session.
                  await this.ai.shutdown();
                  window.location.reload();
                },
              },
            ],
          });
          await confirm.present();
        } catch {
          const alert = await this.alertCtrl.create({
            header: 'Invalid File',
            message: 'The selected file is not a valid Salapi backup.',
            buttons: ['OK'],
          });
          await alert.present();
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async downloadData(): Promise<void> {
    const data = await this.prefs.exportAllData();

    if (Capacitor.isNativePlatform()) {
      try {
        const fileName = `salapi-backup-${Date.now()}.json`;
        const result = await Filesystem.writeFile({
          path: fileName,
          data,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: 'Salapi Backup',
          text: 'Your Salapi data export.',
          url: result.uri,
          dialogTitle: 'Save or share your backup',
        });
      } catch (e) {
        const alert = await this.alertCtrl.create({
          header: 'Export Failed',
          message: 'Could not export your data. Please try again.',
          buttons: ['OK'],
        });
        await alert.present();
      }
    } else {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'salapi-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    }
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
    const alert = await this.alertCtrl.create({
      header: 'Delete All Data',
      message: 'This action cannot be undone. All your data will be permanently deleted.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete Everything',
          role: 'destructive',
          handler: async () => {
            await this.prefs.clearAllData();
            window.location.reload();
          },
        },
      ],
    });
    await alert.present();
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
      message: 'Are you sure you want to sign out?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign Out',
          role: 'destructive',
          handler: () => this._showBackupPrompt(),
        },
      ],
    });
    await confirmAlert.present();
  }

  private async _showBackupPrompt(): Promise<void> {
    const backupAlert = await this.alertCtrl.create({
      header: 'Back up first?',
      message:
        'Your financial data and preferences will be cleared. Download a backup before signing out?',
      backdropDismiss: false,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Sign Out Without Backup',
          role: 'destructive',
          handler: () => this._doSignOut(),
        },
        {
          text: 'Back Up & Sign Out',
          handler: async () => {
            await this.downloadData();
            await this._doSignOut();
          },
        },
      ],
    });
    await backupAlert.present();
  }

  private async _doSignOut(): Promise<void> {
    await this.prefs.clearAllData();
    await this.authService.signOut();
    localStorage.removeItem(GUEST_MODE_KEY);
    // Hard navigate + reload so all in-memory Angular signals are reset.
    window.location.href = '/login';
  }
}
