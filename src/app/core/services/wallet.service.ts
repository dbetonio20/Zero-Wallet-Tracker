import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  Expense,
  Income,
  NewWalletAccountInput,
  SavingsGoal,
  WalletAccount,
  WalletTransaction,
  createSyncedEntity,
  filterActiveSyncedEntities,
  normalizeSyncedEntity,
  touchSyncedEntity,
  tombstoneSyncedEntity,
} from '../models';
import { StorageService } from './storage.service';

const KEY = 'walletAccounts';

@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly _allAccounts = signal<WalletAccount[]>([]);
  private mutationQueue: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private initializationError: Error | null = null;

  readonly accounts = computed(() => filterActiveSyncedEntities(this._allAccounts()));
  readonly accounts$ = toObservable(this.accounts);

  constructor(private readonly storage: StorageService) {
    this.ready = this.reloadFromStorage().catch(error => {
      this.initializationError = this.asError(error, 'Could not load wallet accounts.');
    });
  }

  getAccounts(): Observable<WalletAccount[]> {
    return this.accounts$;
  }

  getAccount(id: string): WalletAccount | undefined {
    return this.accounts().find(account => account.id === id);
  }

  getBalance(account: WalletAccount): number {
    const changes = account.transactions
      .filter(transaction => !transaction.voided && transaction.type !== 'opening')
      .reduce((total, transaction) => total + transaction.amount, 0);
    return this.round(account.openingBalance + changes);
  }

  async getReservedAmount(accountId: string): Promise<number> {
    const savings = await this.storage.getList<SavingsGoal>('savingsGoals');
    const reserved = savings
      .filter(account => account.deletedAt == null)
      .flatMap(account => account.transactions ?? [])
      .filter(transaction => transaction.walletAccountId === accountId)
      .reduce(
        (total, transaction) =>
          total + (transaction.type === 'deposit' ? transaction.amount : -transaction.amount),
        0
      );
    return this.round(Math.max(0, reserved));
  }

  async validateExpenseBalanceChange(previous?: Expense, next?: Expense): Promise<void> {
    const oldEffect = previous?.status === 'paid' && previous.deletedAt === null && previous.accountId
      ? { accountId: previous.accountId, amount: -previous.amount }
      : undefined;
    const newEffect = next?.status === 'paid' && next.deletedAt === null && next.accountId
      ? { accountId: next.accountId, amount: -next.amount }
      : undefined;
    await this.validateLinkedBalanceChange(oldEffect, newEffect);
  }

  async validateIncomeBalanceChange(previous?: Income, next?: Income): Promise<void> {
    const oldEffect = previous && previous.deletedAt === null && previous.accountId
      ? { accountId: previous.accountId, amount: previous.amount }
      : undefined;
    const newEffect = next && next.deletedAt === null && next.accountId
      ? { accountId: next.accountId, amount: next.amount }
      : undefined;
    await this.validateLinkedBalanceChange(oldEffect, newEffect);
  }

  async addAccount(input: NewWalletAccountInput): Promise<void> {
    await this.ensureReady();
    this.validateAccount(input);
    const amount = this.round(input.openingBalance);
    const account = createSyncedEntity({
      ...input,
      id: this.uuid(),
      name: input.name.trim(),
      notes: input.notes.trim(),
      openingBalance: amount,
      isArchived: false,
      transactions: [{
        id: this.uuid(),
        type: 'opening' as const,
        amount,
        date: new Date().toISOString(),
        description: 'Opening balance',
        sourceType: 'opening' as const,
      }],
    });
    await this.mutate(accounts => [...accounts, account]);
  }

  async updateAccount(input: WalletAccount): Promise<void> {
    await this.ensureReady();
    await this.mutate(accounts => {
      const existing = accounts.find(account => account.id === input.id);
      if (!existing || existing.deletedAt !== null) {
        throw new Error('This account is no longer available.');
      }
      this.validateAccount({ ...input, openingBalance: existing.openingBalance });
      return accounts.map(account =>
        account.id === input.id
          ? touchSyncedEntity({
              ...existing,
              name: input.name.trim(),
              type: input.type,
              currency: input.currency,
              notes: input.notes.trim(),
              isArchived: input.isArchived,
              openingBalance: existing.openingBalance,
              transactions: existing.transactions,
              createdAt: existing.createdAt,
            })
          : account
      );
    });
  }

  async archiveAccount(id: string): Promise<void> {
    await this.ensureReady();
    await this.mutate(async accounts => {
      const account = accounts.find(item => item.id === id && item.deletedAt === null);
      if (account && (await this.getReservedAmount(id)) > 0) {
        throw new Error('Release savings reserved from this account before archiving it.');
      }
      return accounts.map(item =>
        item.id === id ? touchSyncedEntity({ ...item, isArchived: true }) : item
      );
    });
  }

  /** Restores an archived account so it is active again. */
  async unarchiveAccount(id: string): Promise<void> {
    await this.ensureReady();
    await this.mutate(accounts =>
      accounts.map(item =>
        item.id === id && item.deletedAt === null
          ? touchSyncedEntity({ ...item, isArchived: false })
          : item
      )
    );
  }

  /**
   * Deletes an account. Refused when it still has activity (transfers, adjustments,
   * paid expenses/incomes, or savings links) so balances and history are never silently lost.
   * Accounts with activity should be archived instead.
   */
  async deleteAccount(id: string): Promise<void> {
    await this.ensureReady();
    const [expenses, incomes, savings] = await Promise.all([
      this.storage.getList<Expense>('expenses'),
      this.storage.getList<Income>('incomes'),
      this.storage.getList<SavingsGoal>('savingsGoals'),
    ]);
    await this.mutate(async accounts => {
      const account = accounts.find(item => item.id === id && item.deletedAt === null);
      if (!account) return accounts;
      const hasLedgerActivity = account.transactions.some(
        transaction => !transaction.voided && transaction.type !== 'opening'
      );
      const hasLinkedRecords =
        expenses.some(item => item.deletedAt === null && item.accountId === id) ||
        incomes.some(item => item.deletedAt === null && item.accountId === id) ||
        savings.some(
          goal =>
            goal.deletedAt == null &&
            (goal.transactions ?? []).some(transaction => transaction.walletAccountId === id)
        );
      if (hasLedgerActivity || hasLinkedRecords) {
        throw new Error(
          'This account has transactions or linked records, so it cannot be deleted. Archive it instead.'
        );
      }
      return accounts.map(item => (item.id === id ? tombstoneSyncedEntity(item) : item));
    });
  }

  async transfer(
    sourceId: string,
    destinationId: string,
    amount: number,
    date: string,
    note = ''
  ): Promise<void> {
    await this.ensureReady();
    const value = this.validateAmount(amount);
    if (!date || Number.isNaN(Date.parse(date))) throw new Error('Choose a valid transfer date.');
    if (sourceId === destinationId) throw new Error('Choose two different accounts.');

    await this.mutate(async accounts => {
      const source = accounts.find(account => account.id === sourceId && !account.isArchived);
      const destination = accounts.find(account => account.id === destinationId && !account.isArchived);
      if (!source || !destination) throw new Error('Choose two active accounts.');
      if (source.currency !== destination.currency) {
        throw new Error('Transfers require accounts with the same currency.');
      }
      const available = this.round(this.getBalance(source) - await this.getReservedAmount(source.id));
      if (value > available) {
        throw new Error('The source account does not have enough unreserved funds.');
      }

      const transferId = this.uuid();
      const timestamp = new Date().toISOString();
      const description = note.trim() || `Transfer to ${destination.name}`;
      return accounts.map(account => {
        if (account.id === sourceId) {
          return touchSyncedEntity({
            ...account,
            transactions: [...account.transactions, {
              id: this.uuid(),
              type: 'transfer-out' as const,
              amount: -value,
              date,
              description,
              sourceType: 'transfer' as const,
              sourceId: transferId,
              transferId,
            }],
            updatedAt: timestamp,
          });
        }
        if (account.id === destinationId) {
          return touchSyncedEntity({
            ...account,
            transactions: [...account.transactions, {
              id: this.uuid(),
              type: 'transfer-in' as const,
              amount: value,
              date,
              description: note.trim() || `Transfer from ${source.name}`,
              sourceType: 'transfer' as const,
              sourceId: transferId,
              transferId,
            }],
            updatedAt: timestamp,
          });
        }
        return account;
      });
    });
  }

  async adjustBalance(accountId: string, correctedBalance: number, date: string, reason = ''): Promise<void> {
    await this.ensureReady();
    if (!Number.isFinite(correctedBalance) || correctedBalance < 0) {
      throw new Error('Enter a valid balance of zero or more.');
    }
    if (!date || Number.isNaN(Date.parse(date))) throw new Error('Choose a valid adjustment date.');

    await this.mutate(async accounts => {
      const account = accounts.find(item => item.id === accountId && !item.isArchived);
      if (!account) throw new Error('This account is no longer available.');
      const reserved = await this.getReservedAmount(accountId);
      if (correctedBalance < reserved) {
        throw new Error('The corrected balance cannot be below savings reserved from this account.');
      }
      const delta = this.round(correctedBalance - this.getBalance(account));
      if (delta === 0) throw new Error('The corrected balance matches the current balance.');
      const transaction: WalletTransaction = {
        id: this.uuid(),
        type: 'adjustment',
        amount: delta,
        date,
        description: reason.trim() || 'Balance adjustment',
        sourceType: 'adjustment',
      };
      return accounts.map(item =>
        item.id === accountId
          ? touchSyncedEntity({ ...item, transactions: [...item.transactions, transaction] })
          : item
      );
    });
  }

  /**
   * Records a transfer whose other side is outside the app (for example, to another bank).
   * Only the given account changes; no expense or income is created and no paired transfer is written.
   */
  async recordExternalTransfer(
    accountId: string,
    direction: 'out' | 'in',
    amount: number,
    date: string,
    description = ''
  ): Promise<void> {
    await this.ensureReady();
    const value = this.validateAmount(amount);
    if (!date || Number.isNaN(Date.parse(date))) throw new Error('Choose a valid transfer date.');

    await this.mutate(async accounts => {
      const account = accounts.find(item => item.id === accountId && !item.isArchived);
      if (!account) throw new Error('This account is no longer available.');
      if (direction === 'out') {
        const reserved = await this.getReservedAmount(accountId);
        if (this.round(this.getBalance(account) - value) < reserved) {
          throw new Error('This transfer would reduce the account below savings reserved from it.');
        }
      }
      const transaction: WalletTransaction = {
        id: this.uuid(),
        type: direction === 'out' ? 'transfer-out' : 'transfer-in',
        amount: direction === 'out' ? -value : value,
        date,
        description: description.trim() || 'External transfer',
        sourceType: 'transfer',
      };
      return accounts.map(item =>
        item.id === accountId
          ? touchSyncedEntity({ ...item, transactions: [...item.transactions, transaction] })
          : item
      );
    });
  }

  async reconcileFinancialRecords(expenses: readonly Expense[], incomes: readonly Income[]): Promise<void> {
    await this.ensureReady();
    await this.mutate(accounts => {
      const desired = new Map<string, { accountId: string; transaction: WalletTransaction }>();
      for (const expense of expenses) {
        if (expense.deletedAt !== null || expense.status !== 'paid' || !expense.accountId) continue;
        const date = expense.paidAt ?? expense.date;
        desired.set(`expense:${expense.id}`, {
          accountId: expense.accountId,
          transaction: {
            id: `expense:${expense.id}`,
            type: 'expense',
            amount: -this.round(expense.amount),
            date,
            description: expense.name || expense.category,
            sourceType: 'expense',
            sourceId: expense.id,
          },
        });
      }
      for (const income of incomes) {
        if (income.deletedAt !== null || !income.accountId) continue;
        desired.set(`income:${income.id}`, {
          accountId: income.accountId,
          transaction: {
            id: `income:${income.id}`,
            type: 'income',
            amount: this.round(income.amount),
            date: income.date,
            description: income.name || income.source,
            sourceType: 'income',
            sourceId: income.id,
          },
        });
      }

      let changed = false;
      const updated = accounts.map(account => {
        let accountChanged = false;
        const transactions = account.transactions.map(existing => {
          if (existing.sourceType !== 'expense' && existing.sourceType !== 'income') return existing;
          const key = `${existing.sourceType}:${existing.sourceId ?? ''}`;
          const expected = desired.get(key);
          if (!expected || expected.accountId !== account.id) {
            if (existing.voided) return existing;
            accountChanged = true;
            changed = true;
            return { ...existing, voided: true };
          }
          const replacement = expected.transaction;
          desired.delete(key);
          if (JSON.stringify(existing) === JSON.stringify(replacement)) return existing;
          accountChanged = true;
          changed = true;
          return replacement;
        });

        for (const [key, expected] of desired) {
          if (expected.accountId !== account.id) continue;
          transactions.push(expected.transaction);
          desired.delete(key);
          accountChanged = true;
          changed = true;
        }
        return accountChanged
          ? touchSyncedEntity({ ...account, transactions })
          : account;
      });
      return changed ? updated : accounts;
    }, true);
  }

  /**
   * Links legacy expenses that have no account to the single active account matching their
   * payment method (exact name, or the only cash/bank/e-wallet account). Ambiguous matches are skipped.
   * Returns the updated expense list, or null when nothing changed.
   */
  async linkLegacyPaymentMethods(expenses: readonly Expense[]): Promise<Expense[] | null> {
    await this.ensureReady();
    const active = this.accounts().filter(account => !account.isArchived);
    const findUnique = (predicate: (account: WalletAccount) => boolean): WalletAccount | null => {
      const matches = active.filter(predicate);
      return matches.length === 1 ? matches[0] : null;
    };
    let changed = false;
    const linked = expenses.map(expense => {
      if (expense.deletedAt !== null || expense.accountId || expense.paymentMethod === 'Credit Card') {
        return expense;
      }
      const method = expense.paymentMethod.trim().toLowerCase();
      const byName = findUnique(account => account.name.trim().toLowerCase() === method);
      const byType: WalletAccount | null =
        byName ??
        (method === 'cash' ? findUnique(account => account.type === 'cash') : null) ??
        (method === 'gcash' ? findUnique(account => account.type === 'e-wallet') : null) ??
        (method === 'bank transfer' || method === 'debit card'
          ? findUnique(account => account.type === 'bank')
          : null);
      if (!byType) return expense;
      changed = true;
      return touchSyncedEntity({ ...expense, accountId: byType.id });
    });
    return changed ? linked : null;
  }

  async reloadFromStorage(): Promise<void> {
    await this.mutationQueue;
    const stored = await this.storage.getList<WalletAccount>(KEY);
    this._allAccounts.set(stored.map(account => normalizeSyncedEntity({
      ...account,
      transactions: account.transactions ?? [],
    })));
    this.initializationError = null;
  }

  async retryLoad(): Promise<void> {
    await this.ready;
    await this.reloadFromStorage();
  }

  private validateAccount(input: Pick<WalletAccount, 'name' | 'type' | 'openingBalance' | 'currency'>): void {
    if (!input.name.trim()) throw new Error('Enter a name for this account.');
    if (!Number.isFinite(input.openingBalance) || input.openingBalance < 0) {
      throw new Error('The opening balance cannot be negative.');
    }
    if (!input.currency.trim()) throw new Error('Choose a currency for this account.');
  }

  private validateAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Enter an amount greater than zero.');
    }

    const value = this.round(amount);
    if (value <= 0) throw new Error('Enter an amount of at least 0.01.');
    return value;
  }

  private async validateLinkedBalanceChange(
    previous?: { accountId: string; amount: number },
    next?: { accountId: string; amount: number }
  ): Promise<void> {
    const affectedIds = new Set(
      [previous?.accountId, next?.accountId].filter((id): id is string => !!id)
    );
    for (const accountId of affectedIds) {
      const account = this._allAccounts().find(
        item => item.id === accountId && item.deletedAt === null
      );
      if (!account) continue;
      const previousAmount = previous?.accountId === accountId ? previous.amount : 0;
      const nextAmount = next?.accountId === accountId ? next.amount : 0;
      const projected = this.round(this.getBalance(account) - previousAmount + nextAmount);
      const reserved = await this.getReservedAmount(accountId);
      if (projected < reserved) {
        throw new Error('This change would reduce the account below savings funds reserved from it.');
      }
    }
  }

  private round(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
    if (this.initializationError) throw this.initializationError;
  }

  private mutate(
    update: (accounts: WalletAccount[]) => WalletAccount[] | Promise<WalletAccount[]>,
    skipUnchanged = false
  ): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const current = this._allAccounts();
      const updated = await update(current);
      if (skipUnchanged && updated === current) return;
      await this.storage.saveList(KEY, updated);
      this._allAccounts.set(updated);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private asError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
