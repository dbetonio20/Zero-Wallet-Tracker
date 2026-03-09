import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SavingsGoal } from '../models';
import { StorageService } from './storage.service';

const KEY = 'savingsGoals';

@Injectable({ providedIn: 'root' })
export class SavingsGoalService {
  private goals$ = new BehaviorSubject<SavingsGoal[]>([]);

  constructor(private storage: StorageService) {
    this.load();
  }

  getGoals(): Observable<SavingsGoal[]> {
    return this.goals$.asObservable();
  }

  getSnapshot(): SavingsGoal[] {
    return this.goals$.value;
  }

  async addGoal(partial: Omit<SavingsGoal, 'id' | 'currentAmount'>): Promise<void> {
    const item: SavingsGoal = { ...partial, currentAmount: 0, id: this.uuid() };
    const updated = [...this.goals$.value, item];
    await this.save(updated);
  }

  async updateGoal(goal: SavingsGoal): Promise<void> {
    const updated = this.goals$.value.map(g => g.id === goal.id ? goal : g);
    await this.save(updated);
  }

  async contribute(id: string, amount: number): Promise<void> {
    const updated = this.goals$.value.map(g =>
      g.id === id ? { ...g, currentAmount: Math.min(g.targetAmount, g.currentAmount + amount) } : g
    );
    await this.save(updated);
  }

  async withdraw(id: string, amount: number): Promise<void> {
    const updated = this.goals$.value.map(g =>
      g.id === id ? { ...g, currentAmount: Math.max(0, g.currentAmount - amount) } : g
    );
    await this.save(updated);
  }

  async deleteGoal(id: string): Promise<void> {
    const updated = this.goals$.value.filter(g => g.id !== id);
    await this.save(updated);
  }

  private async load(): Promise<void> {
    const list = await this.storage.getList<SavingsGoal>(KEY);
    this.goals$.next(list);
  }

  private async save(list: SavingsGoal[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this.goals$.next(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
