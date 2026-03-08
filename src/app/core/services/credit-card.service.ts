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
}
