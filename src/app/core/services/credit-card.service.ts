import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CreditCard } from '../models';
import { StorageService } from './storage.service';

const KEY = 'credit_cards';

@Injectable({ providedIn: 'root' })
export class CreditCardService {
  private cards$ = new BehaviorSubject<CreditCard[]>([]);

  constructor(private storage: StorageService) {
    this.load();
  }

  private async load() {
    const cards = await this.storage.getList<CreditCard>(KEY);
    this.cards$.next(cards);
  }

  getCards() { return this.cards$.asObservable(); }

  async addCard(card: Omit<CreditCard, 'id'>): Promise<void> {
    const item: CreditCard = { ...card, id: crypto.randomUUID() };
    const updated = [...this.cards$.value, item];
    await this.storage.saveList(KEY, updated);
    this.cards$.next(updated);
  }

  async updateCard(card: CreditCard): Promise<void> {
    const updated = this.cards$.value.map(c => c.id === card.id ? card : c);
    await this.storage.saveList(KEY, updated);
    this.cards$.next(updated);
  }

  async deleteCard(id: string): Promise<void> {
    const updated = this.cards$.value.filter(c => c.id !== id);
    await this.storage.saveList(KEY, updated);
    this.cards$.next(updated);
  }

  getById(id: string): CreditCard | undefined {
    return this.cards$.value.find(c => c.id === id);
  }

  getUpcomingDues(days = 7): CreditCard[] {
    const today = new Date();
    return this.cards$.value.filter(card => {
      const due = new Date(today.getFullYear(), today.getMonth(), card.dueDate);
      if (due < today) due.setMonth(due.getMonth() + 1);
      const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= days;
    });
  }

  /**
   * Given an expense date string and a credit card, returns the Date on which
   * that expense is actually due for payment, based on the card's billing cycle.
   *
   * Rule:
   *   - If expenseDay > card.cutoffDate  → expense falls into the NEXT billing cycle
   *   - If expenseDay <= card.cutoffDate → expense falls into the CURRENT billing cycle
   *
   *   The due date is then:
   *   - Same month as the cutoff month     if card.dueDate > card.cutoffDate
   *   - Month AFTER the cutoff month       if card.dueDate <= card.cutoffDate
   *
   * Example: cutoff=5, due=20, expense March 7
   *   → expDay 7 > cutoff 5 → NEXT cycle → cutoffMonth = April
   *   → dueDate 20 > cutoffDate 5 → due in same month → April 20  ✓
   */
  getBillingCycleDueDate(expenseDate: string, card: CreditCard): Date {
    const d = new Date(expenseDate);
    const expDay   = d.getDate();
    let cutoffMonth = d.getMonth();
    let cutoffYear  = d.getFullYear();

    // Expense after cutoff → rolls to next billing cycle
    if (expDay > card.cutoffDate) {
      cutoffMonth += 1;
      if (cutoffMonth > 11) { cutoffMonth = 0; cutoffYear += 1; }
    }

    // Due date position relative to cutoff determines due month
    let dueMonth = cutoffMonth;
    let dueYear  = cutoffYear;
    if (card.dueDate <= card.cutoffDate) {
      dueMonth += 1;
      if (dueMonth > 11) { dueMonth = 0; dueYear += 1; }
    }

    return new Date(dueYear, dueMonth, card.dueDate);
  }
}
