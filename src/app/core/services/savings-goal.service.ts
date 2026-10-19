import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  NewSavingsAccountInput,
  NewSavingsGoalInput,
  SavingsAccount,
  SavingsAccountType,
  SavingsGoal,
  SavingsTransaction,
  SavingsTransactionType,
  createSyncedEntity,
  filterActiveSyncedEntities,
  normalizeSyncedEntity,
  tombstoneSyncedEntity,
  touchSyncedEntity,
} from '../models';
import { StorageService } from './storage.service';

const KEY = 'savingsGoals';

@Injectable({ providedIn: 'root' })
export class SavingsGoalService {
  private readonly _allAccounts = signal<SavingsGoal[]>([]);
  private mutationQueue: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private initializationError: Error | null = null;

  /** Read-only savings accounts, including legacy goals without an explicit type. */
  readonly accounts = computed(() =>
    filterActiveSyncedEntities(this._allAccounts()).map(account => ({
      ...account,
      type: account.type ?? 'goal',
      transactions: account.transactions ?? [],
    }))
  );

  /** Goals only, retained for the dashboard's existing goal interface. */
  readonly goals = computed(() => this.accounts().filter(account => account.type === 'goal'));
  readonly accounts$ = toObservable(this.accounts);
  readonly goals$ = toObservable(this.goals);

  constructor(private storage: StorageService) {
    this.ready = this.load().catch(error => {
      this.initializationError = this.asError(error, 'Could not load savings accounts.');
    });
  }

  getGoals(): Observable<SavingsGoal[]> {
    return this.goals$;
  }

  getAccounts(): Observable<SavingsAccount[]> {
    return this.accounts$;
  }

  /** Returns a synchronous snapshot of the active savings goals. */
  getSnapshot(): SavingsGoal[] {
    return this.goals();
  }

  /** Creates a savings account and records an optional opening deposit. */
  async addAccount(input: NewSavingsAccountInput): Promise<void> {
    await this.ensureReady();
    this.validateAccountInput(input);
    const initialAmount = this.roundAmount(input.initialAmount ?? 0);
    if ((input.initialAmount ?? 0) > 0 && initialAmount <= 0) {
      throw new Error('The initial deposit must be at least 0.01.');
    }
    const id = this.uuid();
    const transaction = initialAmount > 0
      ? this.newTransaction(id, 'deposit', initialAmount, 'Initial deposit')
      : undefined;
    const account: SavingsGoal = createSyncedEntity({
      id,
      name: input.name.trim(),
      type: input.type,
      icon: input.icon || this.defaultIcon(input.type),
      color: input.color || this.defaultColor(input.type),
      targetAmount: input.type === 'goal' ? input.targetAmount! : 0,
      currentAmount: initialAmount,
      deadline: input.type === 'goal' ? input.deadline : undefined,
      description: input.description?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      transactions: transaction ? [transaction] : [],
    });
    await this.mutate(accounts => [...accounts, account]);
  }

  /** Keeps the original goal-creation API used by existing screens. */
  async addGoal(partial: NewSavingsGoalInput): Promise<void> {
    await this.addAccount({
      name: partial.name,
      type: 'goal',
      targetAmount: partial.targetAmount,
      deadline: partial.deadline,
      description: partial.description,
      notes: partial.notes,
      icon: partial.icon,
      color: partial.color,
    });
  }

  /** Updates account details while preserving its balance and transaction history. */
  async updateAccount(account: SavingsAccount): Promise<void> {
    await this.ensureReady();
    await this.mutate(accounts => {
      const existing = accounts.find(item => item.id === account.id);
      if (!existing || existing.deletedAt !== null) {
        throw new Error('This savings account is no longer available.');
      }

      const type = existing.type ?? 'goal';
      this.validateAccountInput({
        name: account.name,
        type,
        targetAmount: account.targetAmount,
        deadline: account.deadline,
      }, false);
      return accounts.map(item =>
        item.id === account.id
          ? touchSyncedEntity({
              ...item,
              name: account.name.trim(),
              type,
              targetAmount: type === 'goal' ? account.targetAmount : 0,
              deadline: type === 'goal' ? account.deadline : undefined,
              description: account.description?.trim() || undefined,
              notes: account.notes?.trim() || undefined,
              icon: account.icon,
              color: account.color,
              transactions: existing.transactions ?? [],
              currentAmount: existing.currentAmount,
              createdAt: existing.createdAt,
            })
          : item
      );
    });
  }

  /** Updates a goal through the legacy dashboard API. */
  async updateGoal(goal: SavingsGoal): Promise<void> {
    await this.ensureReady();
    const existing = this._allAccounts().find(item => item.id === goal.id);
    if (!existing || existing.deletedAt !== null) {
      throw new Error('This savings goal is no longer available.');
    }
    await this.updateAccount({
      ...existing,
      ...goal,
      type: existing.type ?? 'goal',
      currentAmount: existing.currentAmount,
      transactions: existing.transactions ?? [],
    });
  }

  /** Records a deposit and updates the balance and history in one persisted account record. */
  async contribute(id: string, amount: number, description?: string): Promise<void> {
    await this.recordTransaction(id, 'deposit', amount, description);
  }

  /** Records a withdrawal without allowing the account balance to become negative. */
  async withdraw(id: string, amount: number, description?: string): Promise<void> {
    await this.recordTransaction(id, 'withdrawal', amount, description);
  }

  /** Tombstones an account while retaining its transaction history in stored data. */
  async deleteAccount(id: string): Promise<void> {
    await this.ensureReady();
    await this.mutate(accounts =>
      accounts.map(account => account.id === id ? tombstoneSyncedEntity(account) : account)
    );
  }

  /** Legacy alias for deleting a savings goal. */
  async deleteGoal(id: string): Promise<void> {
    await this.deleteAccount(id);
  }

  /** Reloads account signals from IndexedDB after a cloud-sync merge. */
  async reloadFromStorage(): Promise<void> {
    await this.mutationQueue;
    const list = await this.storage.getList<SavingsGoal>(KEY);
    this._allAccounts.set(list.map(account => normalizeSyncedEntity(account)));
    this.initializationError = null;
  }

  /** Retries the initial read after a storage failure. */
  async retryLoad(): Promise<void> {
    await this.ready;
    await this.reloadFromStorage();
  }

  private async recordTransaction(
    id: string,
    type: SavingsTransactionType,
    amount: number,
    description?: string
  ): Promise<void> {
    await this.ensureReady();
    const normalizedAmount = this.roundAmount(amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Enter an amount greater than zero.');
    }
    if (normalizedAmount <= 0) {
      throw new Error('Enter an amount of at least 0.01.');
    }
    await this.mutate(accounts => {
      const existing = accounts.find(account => account.id === id && account.deletedAt === null);
      if (!existing) {
        throw new Error('This savings account is no longer available.');
      }
      if (type === 'withdrawal' && normalizedAmount > existing.currentAmount) {
        throw new Error('The withdrawal cannot exceed the available balance.');
      }

      const change = type === 'deposit' ? normalizedAmount : -normalizedAmount;
      const updatedBalance = this.roundAmount(existing.currentAmount + change);
      const transaction = this.newTransaction(id, type, normalizedAmount, description);
      return accounts.map(account =>
        account.id === id
          ? touchSyncedEntity({
              ...account,
              currentAmount: updatedBalance,
              transactions: [...(account.transactions ?? []), transaction],
            })
          : account
      );
    });
  }

  private validateAccountInput(
    input: NewSavingsAccountInput,
    validateInitialAmount = true
  ): void {
    if (!input.name.trim()) {
      throw new Error('Enter a name for this savings account.');
    }
    if (input.type === 'goal') {
      if (!Number.isFinite(input.targetAmount) || (input.targetAmount ?? 0) <= 0) {
        throw new Error('Enter a goal target greater than zero.');
      }
      if (!input.deadline || Number.isNaN(Date.parse(input.deadline))) {
        throw new Error('Choose a valid target deadline.');
      }
    }
    if (
      validateInitialAmount &&
      input.initialAmount !== undefined &&
      (!Number.isFinite(input.initialAmount) || input.initialAmount < 0)
    ) {
      throw new Error('The initial deposit cannot be negative.');
    }
  }

  private newTransaction(
    accountId: string,
    type: SavingsTransactionType,
    amount: number,
    description?: string
  ): SavingsTransaction {
    return {
      id: this.uuid(),
      accountId,
      type,
      amount,
      date: new Date().toISOString(),
      description: description?.trim() || undefined,
    };
  }

  private defaultIcon(type: SavingsAccountType): string {
    return type === 'goal' ? 'flag-outline' : type === 'flexible' ? 'wallet-outline' : 'leaf-outline';
  }

  private defaultColor(type: SavingsAccountType): string {
    return type === 'goal' ? '#2dd36f' : type === 'flexible' ? '#3dc2ff' : '#a3b18a';
  }

  private async load(): Promise<void> {
    await this.reloadFromStorage();
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
    if (this.initializationError) throw this.initializationError;
  }

  private asError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  private mutate(update: (accounts: SavingsGoal[]) => SavingsGoal[]): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const updated = update(this._allAccounts());
      await this.storage.saveList(KEY, updated);
      this._allAccounts.set(updated);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private roundAmount(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
