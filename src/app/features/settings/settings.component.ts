import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
  IonButtons, IonBackButton,
  AlertController,
} from '@ionic/angular/standalone';
import { PreferencesService } from '../../core/services/preferences.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonContent, IonItem, IonLabel,
    IonButtons, IonBackButton,
  ],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  userName = 'User';
  theme = 'system';
  currencySymbol = '₱';
  currencyCode = 'PHP';

  constructor(
    private prefs: PreferencesService,
    private alertCtrl: AlertController,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.theme = await this.prefs.getTheme();
    this.currencySymbol = await this.prefs.getCurrencySymbol();
    this.currencyCode = await this.prefs.getCurrencyCode();
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

  async downloadData(): Promise<void> {
    const data = await this.prefs.exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zero-wallet-backup.json';
    a.click();
    URL.revokeObjectURL(url);
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
}
