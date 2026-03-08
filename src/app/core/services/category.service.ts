import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Category, DEFAULT_CATEGORIES } from '../models';
import { StorageService } from './storage.service';

const KEY = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private categories$ = new BehaviorSubject<Category[]>([]);

  constructor(private storage: StorageService) {
    this.loadCategories();
  }

  /** Returns the live observable of all categories. */
  getCategories(): Observable<Category[]> {
    return this.categories$.asObservable();
  }

  /** Returns a snapshot (sync) of the current categories. */
  getSnapshot(): Category[] {
    return this.categories$.value;
  }

  /** Resolves the color for a category name; falls back to a neutral grey. */
  getColor(name: string): string {
    const cat = this.categories$.value.find(c => c.name === name);
    return cat?.color ?? '#94a3b8';
  }

  /** Resolves the Ionicon name for a category; falls back to a generic icon. */
  getIcon(name: string): string {
    const cat = this.categories$.value.find(c => c.name === name);
    return cat?.icon ?? 'pricetag-outline';
  }

  async addCategory(partial: Omit<Category, 'id'>): Promise<void> {
    const item: Category = { ...partial, id: this.uuid() };
    const updated = [...this.categories$.value, item];
    await this.save(updated);
  }

  async updateCategory(updated: Category): Promise<void> {
    const list = this.categories$.value.map(c => c.id === updated.id ? updated : c);
    await this.save(list);
  }

  async deleteCategory(id: string): Promise<void> {
    const list = this.categories$.value.filter(c => c.id !== id);
    await this.save(list);
  }

  private async loadCategories(): Promise<void> {
    let list = await this.storage.getList<Category>(KEY);
    if (!list.length) {
      // Seed defaults on first run
      list = DEFAULT_CATEGORIES.map(d => ({ ...d, id: this.uuid() }));
      await this.storage.saveList(KEY, list);
    }
    this.categories$.next(list);
  }

  private async save(list: Category[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this.categories$.next(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
