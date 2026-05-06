import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  Expense,
  Income,
  Installment,
  InstallmentPayment,
  ImportReport,
  PaymentAllocation,
  SyncImportIssue,
  SyncMetadata,
  SyncWarning,
  UserPreferences,
  CreditCard,
  isActiveSyncedEntity,
  normalizeSyncedEntity,
  touchSyncedEntity,
} from '../models';
import { StorageService } from './storage.service';
import { SyncService } from './sync.service';

const KEYS = {
  USER_NAME: 'pref_user_name',
  THEME: 'pref_theme',
  CURRENCY_SYMBOL: 'pref_currency_symbol',
  CURRENCY_CODE: 'pref_currency_code',
  COLOR_PALETTE: 'pref_color_palette',
  PREFERENCES_META: 'pref_sync_meta',
};

const IMPORT_LIST_KEYS = [
  'expenses',
  'incomes',
  'installments',
  'installmentPayments',
  'credit_cards',
  'paymentAllocations',
  'savingsGoals',
  'categories',
] as const;

type ImportListKey = (typeof IMPORT_LIST_KEYS)[number];

type ImportDataByKey = {
  expenses: NormalizedImportedRecord[];
  incomes: NormalizedImportedRecord[];
  installments: NormalizedImportedRecord[];
  installmentPayments: NormalizedImportedRecord[];
  credit_cards: NormalizedImportedRecord[];
  paymentAllocations: NormalizedImportedRecord[];
  savingsGoals: NormalizedImportedRecord[];
  categories: NormalizedImportedRecord[];
};

type ImportedRecord = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  serverUpdatedAt?: string | null;
  deletedAt?: string | null;
};

type NormalizedImportedRecord = ImportedRecord & SyncMetadata;

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  /** Reactive signal for the active currency code (e.g. 'PHP'). */
  readonly currencyCode = signal<string>('PHP');
  /** Reactive signal for the active currency symbol (e.g. '₱'). */
  readonly currencySymbol = signal<string>('₱');
  /** Reactive signal for the active color palette id (e.g. 'default'). */
  readonly colorPalette = signal<string>('default');

  /** Observable alias — use with async pipe or combineLatest. */
  readonly currencyCode$ = toObservable(this.currencyCode);
  /** Observable alias — use with async pipe or combineLatest. */
  readonly currencySymbol$ = toObservable(this.currencySymbol);
  /** Observable alias — use with async pipe or combineLatest. */
  readonly colorPalette$ = toObservable(this.colorPalette);

  constructor(
    private storage: StorageService,
    private syncService: SyncService,
  ) {
    this.loadCurrency();
    this.loadPalette();
  }

  private async loadCurrency(): Promise<void> {
    const code = (await this.storage.get<string>(KEYS.CURRENCY_CODE)) ?? 'PHP';
    const symbol = (await this.storage.get<string>(KEYS.CURRENCY_SYMBOL)) ?? '₱';
    this.currencyCode.set(code);
    this.currencySymbol.set(symbol);
  }

  private async loadPalette(): Promise<void> {
    const palette = (await this.storage.get<string>(KEYS.COLOR_PALETTE)) ?? 'default';
    this.colorPalette.set(palette);
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
    await this.touchPreferencesMetadata();
  }

  async getTheme(): Promise<string> {
    return (await this.storage.get<string>(KEYS.THEME)) ?? 'system';
  }

  async setTheme(theme: string): Promise<void> {
    await this.storage.set(KEYS.THEME, theme);
    await this.touchPreferencesMetadata();
  }

  async getPalette(): Promise<string> {
    return (await this.storage.get<string>(KEYS.COLOR_PALETTE)) ?? 'default';
  }

  async setPalette(palette: string): Promise<void> {
    await this.storage.set(KEYS.COLOR_PALETTE, palette);
    this.colorPalette.set(palette);
    await this.touchPreferencesMetadata();
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
    await this.touchPreferencesMetadata();
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
    await this.storage.remove('categories');
    await this.storage.remove(KEYS.USER_NAME);
    await this.storage.remove(KEYS.THEME);
    await this.storage.remove(KEYS.CURRENCY_SYMBOL);
    await this.storage.remove(KEYS.CURRENCY_CODE);
    await this.storage.remove(KEYS.COLOR_PALETTE);
    await this.storage.remove(KEYS.PREFERENCES_META);
  }

  async importAllData(json: string, mode: 'strict' | 'best-effort' = 'strict'): Promise<ImportReport> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(json) as Record<string, unknown>;
    } catch {
      const issue = this.createImportIssue(
        'invalid-json',
        'import',
        'Import file is not valid JSON and cannot be processed safely.'
      );
      throw new Error(issue.message);
    }

    const warnings: SyncWarning[] = [];
    const issues: SyncImportIssue[] = [];
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const importedKeys = new Set<ImportListKey>();

    const mergedByKey: ImportDataByKey = {
      expenses: [],
      incomes: [],
      installments: [],
      installmentPayments: [],
      credit_cards: [],
      paymentAllocations: [],
      savingsGoals: [],
      categories: [],
    };

    for (const key of IMPORT_LIST_KEYS) {
      const existing = await this.storage.getList<ImportedRecord>(key);
      const normalizedExisting = existing.map(record => normalizeSyncedEntity(record));
      const payload = data[key];

      if (payload === undefined) {
        mergedByKey[key] = normalizedExisting;
        continue;
      }

      importedKeys.add(key);

      if (!Array.isArray(payload)) {
        const issue = this.createImportIssue('invalid-entity-shape', key, `${key} must be an array.`);
        if (mode === 'strict') {
          throw new Error(issue.message);
        }
        issues.push(issue);
        skippedCount += 1;
        mergedByKey[key] = normalizedExisting;
        continue;
      }

      const normalizedIncoming = this.normalizeImportedRecords(payload, key, warnings, issues, mode);
      const mergeResult = this.syncService.mergeSyncedRecords(normalizedExisting, normalizedIncoming, key);

      warnings.push(...mergeResult.warnings);
      importedCount += normalizedIncoming.length;
      mergedByKey[key] = mergeResult.merged;
    }

    const integrityIssues = this.validateReferentialIntegrity(mergedByKey);
    if (integrityIssues.length > 0) {
      issues.push(...integrityIssues);
      if (mode === 'strict') {
        throw new Error(
          `Import blocked by integrity rules: ${integrityIssues[0].message}`
        );
      }
      skippedCount += integrityIssues.length;
    }

    for (const key of importedKeys) {
      await this.storage.saveList(key, mergedByKey[key]);
      updatedCount += mergedByKey[key].length;
    }

    if (data['preferences'] && typeof data['preferences'] === 'object') {
      const mergedPreferences = await this.mergeImportedPreferences(data['preferences'] as Partial<UserPreferences>, warnings);
      await this.persistPreferenceDocument(mergedPreferences);
      updatedCount += 1;
    }

    this.syncService.appendWarnings(warnings);

    return {
      mode,
      importedCount,
      updatedCount,
      skippedCount,
      warnings,
      issues,
    };
  }

  async getPreferenceDocument(): Promise<UserPreferences> {
    const metadata = await this.getPreferencesMetadata();

    return {
      id: 'preferences',
      userName: await this.getUserName(),
      theme: await this.getTheme(),
      currencySymbol: await this.getCurrencySymbol(),
      currencyCode: await this.getCurrencyCode(),
      palette: await this.getPalette(),
      ...metadata,
    };
  }

  private async getPreferencesMetadata(): Promise<SyncMetadata> {
    const metadata = await this.storage.get<Partial<SyncMetadata>>(KEYS.PREFERENCES_META);
    const normalized = normalizeSyncedEntity({ id: 'preferences', ...metadata });

    return {
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      serverUpdatedAt: normalized.serverUpdatedAt,
      deletedAt: normalized.deletedAt,
    };
  }

  private async touchPreferencesMetadata(): Promise<void> {
    const metadata = await this.getPreferencesMetadata();
    await this.storage.set(KEYS.PREFERENCES_META, touchSyncedEntity(metadata));
  }

  private async persistPreferenceDocument(preferences: UserPreferences): Promise<void> {
    await this.storage.set(KEYS.USER_NAME, preferences.userName);
    await this.storage.set(KEYS.THEME, preferences.theme);
    await this.storage.set(KEYS.CURRENCY_SYMBOL, preferences.currencySymbol);
    await this.storage.set(KEYS.CURRENCY_CODE, preferences.currencyCode);
    await this.storage.set(KEYS.COLOR_PALETTE, preferences.palette);
    await this.storage.set(KEYS.PREFERENCES_META, {
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
      serverUpdatedAt: preferences.serverUpdatedAt,
      deletedAt: preferences.deletedAt,
    });

    this.currencyCode.set(preferences.currencyCode);
    this.currencySymbol.set(preferences.currencySymbol);
    this.colorPalette.set(preferences.palette);
  }

  private normalizeImportedRecords(
    payload: unknown[],
    entityType: string,
    warnings: SyncWarning[],
    issues: SyncImportIssue[],
    mode: 'strict' | 'best-effort'
  ): NormalizedImportedRecord[] {
    const seenIds = new Set<string>();
    const normalized: NormalizedImportedRecord[] = [];

    for (const rawRecord of payload) {
      if (!this.isImportedRecord(rawRecord)) {
        const issue = this.createImportIssue('invalid-entity-shape', entityType, `${entityType} contains a record without a valid id.`);
        if (mode === 'strict') {
          throw new Error(issue.message);
        }
        issues.push(issue);
        continue;
      }

      if (seenIds.has(rawRecord.id)) {
        const issue = this.createImportIssue('duplicate-id', entityType, `${entityType} contains a duplicate id: ${rawRecord.id}.`, rawRecord.id);
        if (mode === 'strict') {
          throw new Error(issue.message);
        }
        issues.push(issue);
        continue;
      }

      seenIds.add(rawRecord.id);

      if (!rawRecord.serverUpdatedAt) {
        warnings.push({
          code: 'missing-server-updated-at',
          entityType,
          recordId: rawRecord.id,
          message: `${entityType} ${rawRecord.id} is missing serverUpdatedAt; import will fall back to updatedAt.`,
        });
      }

      if (!rawRecord.updatedAt) {
        warnings.push({
          code: 'missing-updated-at',
          entityType,
          recordId: rawRecord.id,
          message: `${entityType} ${rawRecord.id} is missing updatedAt; import assigned a fallback timestamp.`,
        });
      }

      if (rawRecord.deletedAt === undefined) {
        warnings.push({
          code: 'missing-deleted-at',
          entityType,
          recordId: rawRecord.id,
          message: `${entityType} ${rawRecord.id} is missing deletedAt; import normalized it to null.`,
        });
      }

      const timestampIssue = this.findTimestampIssue(rawRecord, entityType);
      if (timestampIssue) {
        if (mode === 'strict') {
          throw new Error(timestampIssue.message);
        }
        issues.push(timestampIssue);
        continue;
      }

      normalized.push(normalizeSyncedEntity(rawRecord));
    }

    return normalized;
  }

  private async mergeImportedPreferences(
    partial: Partial<UserPreferences>,
    warnings: SyncWarning[]
  ): Promise<UserPreferences> {
    const current = await this.getPreferenceDocument();
    const currentMetadata = await this.getPreferencesMetadata();
    const nextMetadata = partial.updatedAt
      ? touchSyncedEntity(currentMetadata, partial.updatedAt)
      : touchSyncedEntity(currentMetadata);

    if (!partial.serverUpdatedAt) {
      warnings.push({
        code: 'missing-server-updated-at',
        entityType: 'preferences',
        recordId: 'preferences',
        message: 'Preferences import is missing serverUpdatedAt; falling back to updatedAt authority.',
      });
    }

    return {
      ...current,
      ...nextMetadata,
      userName: partial.userName ?? current.userName,
      theme: partial.theme ?? current.theme,
      currencySymbol: partial.currencySymbol ?? current.currencySymbol,
      currencyCode: partial.currencyCode ?? current.currencyCode,
      palette: partial.palette ?? current.palette,
      serverUpdatedAt: partial.serverUpdatedAt ?? current.serverUpdatedAt,
      deletedAt: partial.deletedAt ?? current.deletedAt,
    };
  }

  private createImportIssue(
    code: SyncImportIssue['code'],
    entityType: string,
    message: string,
    recordId?: string
  ): SyncImportIssue {
    return { code, entityType, recordId, message };
  }

  private isImportedRecord(value: unknown): value is ImportedRecord {
    return typeof value === 'object' && value !== null && typeof (value as ImportedRecord).id === 'string';
  }

  private findTimestampIssue(record: ImportedRecord, entityType: string): SyncImportIssue | null {
    const timestampFields: Array<keyof Pick<ImportedRecord, 'createdAt' | 'updatedAt' | 'serverUpdatedAt' | 'deletedAt'>> = [
      'createdAt',
      'updatedAt',
      'serverUpdatedAt',
      'deletedAt',
    ];

    for (const field of timestampFields) {
      const value = record[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return this.createImportIssue(
          'invalid-timestamp',
          entityType,
          `${entityType} ${record.id} has an invalid ${field} value.`,
          record.id
        );
      }
    }

    return null;
  }

  private validateReferentialIntegrity(dataByKey: ImportDataByKey): SyncImportIssue[] {
    const issues: SyncImportIssue[] = [];

    const activeCards = this.indexActiveIds(dataByKey.credit_cards);
    const activeIncomes = this.indexActiveIds(dataByKey.incomes);
    const activeExpenses = this.indexActiveIds(dataByKey.expenses);
    const activeInstallments = this.indexActiveIds(dataByKey.installments);
    const activeInstallmentPayments = this.indexActiveIds(dataByKey.installmentPayments);

    for (const rawExpense of dataByKey.expenses as Expense[]) {
      if (!isActiveSyncedEntity(rawExpense)) continue;
      if (
        rawExpense.paymentMethod === 'Credit Card' &&
        rawExpense.creditCardId &&
        !activeCards.has(rawExpense.creditCardId)
      ) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'expenses',
            `Expense ${rawExpense.id} references missing credit card ${rawExpense.creditCardId}.`,
            rawExpense.id
          )
        );
      }
    }

    for (const rawInstallment of dataByKey.installments as Installment[]) {
      if (!isActiveSyncedEntity(rawInstallment)) continue;
      if (!activeCards.has(rawInstallment.cardId)) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'installments',
            `Installment ${rawInstallment.id} references missing credit card ${rawInstallment.cardId}.`,
            rawInstallment.id
          )
        );
      }
    }

    for (const rawPayment of dataByKey.installmentPayments as InstallmentPayment[]) {
      if (!isActiveSyncedEntity(rawPayment)) continue;
      if (!activeInstallments.has(rawPayment.installmentId)) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'installmentPayments',
            `Installment payment ${rawPayment.id} references missing installment ${rawPayment.installmentId}.`,
            rawPayment.id
          )
        );
      }
    }

    for (const rawAllocation of dataByKey.paymentAllocations as PaymentAllocation[]) {
      if (!isActiveSyncedEntity(rawAllocation)) continue;

      const hasExpenseTarget = !!rawAllocation.expenseId;
      const hasPaymentTarget = !!rawAllocation.installmentPaymentId;

      if (hasExpenseTarget === hasPaymentTarget) {
        issues.push(
          this.createImportIssue(
            'invalid-entity-shape',
            'paymentAllocations',
            `Allocation ${rawAllocation.id} must reference exactly one target: expenseId or installmentPaymentId.`,
            rawAllocation.id
          )
        );
        continue;
      }

      if (!activeIncomes.has(rawAllocation.incomeId)) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'paymentAllocations',
            `Allocation ${rawAllocation.id} references missing income ${rawAllocation.incomeId}.`,
            rawAllocation.id
          )
        );
      }

      if (rawAllocation.expenseId && !activeExpenses.has(rawAllocation.expenseId)) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'paymentAllocations',
            `Allocation ${rawAllocation.id} references missing expense ${rawAllocation.expenseId}.`,
            rawAllocation.id
          )
        );
      }

      if (
        rawAllocation.installmentPaymentId &&
        !activeInstallmentPayments.has(rawAllocation.installmentPaymentId)
      ) {
        issues.push(
          this.createImportIssue(
            'broken-reference',
            'paymentAllocations',
            `Allocation ${rawAllocation.id} references missing installment payment ${rawAllocation.installmentPaymentId}.`,
            rawAllocation.id
          )
        );
      }
    }

    return issues;
  }

  private indexActiveIds<T extends { id: string } & SyncMetadata>(records: readonly T[]): Set<string> {
    return new Set(records.filter(isActiveSyncedEntity).map(record => record.id));
  }
}
