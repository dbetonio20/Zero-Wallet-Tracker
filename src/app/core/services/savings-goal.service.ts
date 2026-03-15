import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { SavingsGoal } from '../models';
import { StorageService } from './storage.service';

const KEY = 'savingsGoals';

@Injectable({ providedIn: 'root' })
export class SavingsGoalService {
  private readonly _goals = signal<SavingsGoal[]>([]);

  /** Read-only signal — use directly in templates or computed(). */
  readonly goals = this._goals.asReadonly();

  /** Observable alias for async-pipe consumers. */
  readonly goals$ = toObservable(this._goals);

  constructor(private storage: StorageService) {
    this.load();
  }

  getGoals(): Observable<SavingsGoal[]> {
    return this.goals$;
  }

  /** Returns a synchronous snapshot of the current goals. */
  getSnapshot(): SavingsGoal[] {
    return this._goals();
  }

  async addGoal(partial: Omit<SavingsGoal, 'id' | 'currentAmount'>): Promise<void> {
    const item: SavingsGoal = { ...partial, currentAmount: 0, id: this.uuid() };
    const updated = [...this._goals(), item];
    await this.save(updated);
  }

  async updateGoal(goal: SavingsGoal): Promise<void> {
    const updated = this._goals().map(g => g.id === goal.id ? goal : g);
    await this.save(updated);
  }

  async contribute(id: string, amount: number): Promise<void> {
    const updated = this._goals().map(g =>
      g.id === id ? { ...g, currentAmount: Math.min(g.targetAmount, g.currentAmount + amount) } : g
    );
    await this.save(updated);
  }

  async withdraw(id: string, amount: number): Promise<void> {
    const updated = this._goals().map(g =>
      g.id === id ? { ...g, currentAmount: Math.max(0, g.currentAmount - amount) } : g
    );
    await this.save(updated);
  }

  async deleteGoal(id: string): Promise<void> {
    const updated = this._goals().filter(g => g.id !== id);
    await this.save(updated);
  }

  private async load(): Promise<void> {
    const list = await this.storage.getList<SavingsGoal>(KEY);
    this._goals.set(list);
  }

  private async save(list: SavingsGoal[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this._goals.set(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
