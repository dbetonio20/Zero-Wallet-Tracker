import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  NewSavingsGoalInput,
  SavingsGoal,
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
  private readonly _allGoals = signal<SavingsGoal[]>([]);

  /** Read-only signal — use directly in templates or computed(). */
  readonly goals = computed(() => filterActiveSyncedEntities(this._allGoals()));

  /** Observable alias for async-pipe consumers. */
  readonly goals$ = toObservable(this.goals);

  constructor(private storage: StorageService) {
    this.load();
  }

  getGoals(): Observable<SavingsGoal[]> {
    return this.goals$;
  }

  /** Returns a synchronous snapshot of the current goals. */
  getSnapshot(): SavingsGoal[] {
    return this.goals();
  }

  async addGoal(partial: NewSavingsGoalInput): Promise<void> {
    const item: SavingsGoal = createSyncedEntity({
      ...partial,
      currentAmount: 0,
      id: this.uuid(),
    });
    const updated = [...this._allGoals(), item];
    await this.save(updated);
  }

  async updateGoal(goal: SavingsGoal): Promise<void> {
    const updated = this._allGoals().map(existingGoal =>
      existingGoal.id === goal.id
        ? touchSyncedEntity({ ...existingGoal, ...goal, createdAt: existingGoal.createdAt })
        : existingGoal
    );
    await this.save(updated);
  }

  async contribute(id: string, amount: number): Promise<void> {
    const updated = this._allGoals().map(goal =>
      goal.id === id
        ? touchSyncedEntity({
            ...goal,
            currentAmount: Math.min(goal.targetAmount, goal.currentAmount + amount),
          })
        : goal
    );
    await this.save(updated);
  }

  async withdraw(id: string, amount: number): Promise<void> {
    const updated = this._allGoals().map(goal =>
      goal.id === id
        ? touchSyncedEntity({
            ...goal,
            currentAmount: Math.max(0, goal.currentAmount - amount),
          })
        : goal
    );
    await this.save(updated);
  }

  async deleteGoal(id: string): Promise<void> {
    const updated = this._allGoals().map(goal =>
      goal.id === id ? tombstoneSyncedEntity(goal) : goal
    );
    await this.save(updated);
  }

  private async load(): Promise<void> {
    const list = await this.storage.getList<SavingsGoal>(KEY);
    this._allGoals.set(list.map(goal => normalizeSyncedEntity(goal)));
  }

  private async save(list: SavingsGoal[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this._allGoals.set(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
