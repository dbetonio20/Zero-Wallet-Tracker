import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { StorageService } from './storage.service';

const KEYS = {
  USER_NAME: 'pref_user_name',
  THEME: 'pref_theme',
  CURRENCY_SYMBOL: 'pref_currency_symbol',
  CURRENCY_CODE: 'pref_currency_code',
};

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private currencyCode$ = new BehaviorSubject<string>('PHP');
  private currencySymbol$ = new BehaviorSubject<string>('₱');

  constructor(private storage: StorageService) {
    this.loadCurrency();
  }

  private async loadCurrency(): Promise<void> {
    const code = (await this.storage.get<string>(KEYS.CURRENCY_CODE)) ?? 'PHP';
    const symbol = (await this.storage.get<string>(KEYS.CURRENCY_SYMBOL)) ?? '₱';
    this.currencyCode$.next(code);
    this.currencySymbol$.next(symbol);
  }

  getCurrencyCode$() { return this.currencyCode$.asObservable(); }
  getCurrencySymbol$() { return this.currencySymbol$.asObservable(); }
  get currentCurrencyCode() { return this.currencyCode$.value; }
  get currentCurrencySymbol() { return this.currencySymbol$.value; }

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
    this.currencyCode$.next(code);
    this.currencySymbol$.next(symbol);
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
    await this.storage.remove(KEYS.USER_NAME);
    await this.storage.remove(KEYS.THEME);
    await this.storage.remove(KEYS.CURRENCY_SYMBOL);
    await this.storage.remove(KEYS.CURRENCY_CODE);
  }

  async exportAllData(): Promise<string> {
    const data: Record<string, unknown> = {};
    for (const key of ['expenses', 'incomes', 'installments', 'installmentPayments', 'credit_cards']) {
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
}
