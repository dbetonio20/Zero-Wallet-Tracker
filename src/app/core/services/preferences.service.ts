import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { StorageService } from './storage.service';

const KEYS = {
  USER_NAME: 'pref_user_name',
  THEME: 'pref_theme',
  CURRENCY_SYMBOL: 'pref_currency_symbol',
  CURRENCY_CODE: 'pref_currency_code',
};

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  /** Reactive signal for the active currency code (e.g. 'PHP'). */
  readonly currencyCode = signal<string>('PHP');
  /** Reactive signal for the active currency symbol (e.g. '₱'). */
  readonly currencySymbol = signal<string>('₱');

  /** Observable alias — use with async pipe or combineLatest. */
  readonly currencyCode$ = toObservable(this.currencyCode);
  /** Observable alias — use with async pipe or combineLatest. */
  readonly currencySymbol$ = toObservable(this.currencySymbol);

  constructor(private storage: StorageService) {
    this.loadCurrency();
  }

  private async loadCurrency(): Promise<void> {
    const code = (await this.storage.get<string>(KEYS.CURRENCY_CODE)) ?? 'PHP';
    const symbol = (await this.storage.get<string>(KEYS.CURRENCY_SYMBOL)) ?? '₱';
    this.currencyCode.set(code);
    this.currencySymbol.set(symbol);
  }

  /** @deprecated Use `currencyCode$` field directly. */
  getCurrencyCode$() { return this.currencyCode$; }
  /** @deprecated Use `currencySymbol$` field directly. */
  getCurrencySymbol$() { return this.currencySymbol$; }
  get currentCurrencyCode() { return this.currencyCode(); }
  get currentCurrencySymbol() { return this.currencySymbol(); }

  async getUserName(): Promise<string> {
    return (await this.storage.get<string>(KEYS.USER_NAME)) ?? 'User';
  }

  async setUserName(name: string): Promise<void> {
    await this.storage.set(KEYS.USER_NAME, name);
  }

  async getTheme(): Promise<string> {
    return (await this.storage.get<string>(KEYS.THEME)) ?? 'system';
  }

  async setTheme(theme: string): Promise<void> {
    await this.storage.set(KEYS.THEME, theme);
  }

  async getCurrencySymbol(): Promise<string> {
    return (await this.storage.get<string>(KEYS.CURRENCY_SYMBOL)) ?? '₱';
  }

  async getCurrencyCode(): Promise<string> {
    return (await this.storage.get<string>(KEYS.CURRENCY_CODE)) ?? 'PHP';
  }

  async setCurrency(symbol: string, code: string): Promise<void> {
    await this.storage.set(KEYS.CURRENCY_SYMBOL, symbol);
    await this.storage.set(KEYS.CURRENCY_CODE, code);
    this.currencyCode.set(code);
    this.currencySymbol.set(symbol);
  }

  getUserInitial(name: string): string {
    return (name?.charAt(0) || 'U').toUpperCase();
  }

  async clearAllData(): Promise<void> {
    await this.storage.remove('expenses');
    await this.storage.remove('incomes');
    await this.storage.remove('installments');
    await this.storage.remove('installmentPayments');
    await this.storage.remove('credit_cards');
    await this.storage.remove('paymentAllocations');
    await this.storage.remove('savingsGoals');
    await this.storage.remove(KEYS.USER_NAME);
    await this.storage.remove(KEYS.THEME);
    await this.storage.remove(KEYS.CURRENCY_SYMBOL);
    await this.storage.remove(KEYS.CURRENCY_CODE);
  }

  async exportAllData(): Promise<string> {
    const data: Record<string, unknown> = {};
    for (const key of ['expenses', 'incomes', 'installments', 'installmentPayments', 'credit_cards', 'paymentAllocations']) {
      data[key] = await this.storage.get(key) ?? [];
    }
    data['preferences'] = {
      userName: await this.getUserName(),
      theme: await this.getTheme(),
      currencySymbol: await this.getCurrencySymbol(),
      currencyCode: await this.getCurrencyCode(),
    };
    return JSON.stringify(data, null, 2);
  }

  async importAllData(json: string): Promise<void> {
    const data = JSON.parse(json);
    const listKeys = ['expenses', 'incomes', 'installments', 'installmentPayments', 'credit_cards', 'paymentAllocations', 'savingsGoals'];
    for (const key of listKeys) {
      // Always write — use the backup value if it's a valid array, otherwise
      // reset to [] so stale storage data from a previous session is cleared.
      await this.storage.set(key, Array.isArray(data[key]) ? data[key] : []);
    }
    if (data['preferences']) {
      const p = data['preferences'];
      if (p.userName) await this.setUserName(p.userName);
      if (p.theme) await this.setTheme(p.theme);
      if (p.currencySymbol && p.currencyCode) {
        await this.setCurrency(p.currencySymbol, p.currencyCode);
      }
    }
  }
}
