import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { Category, DEFAULT_CATEGORIES } from '../models';
import { StorageService } from './storage.service';

const KEY = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly _categories = signal<Category[]>([]);

  /** Read-only signal — use directly in templates or computed(). */
  readonly categories = this._categories.asReadonly();

  /** Observable alias for async-pipe consumers. */
  readonly categories$ = toObservable(this._categories);

  constructor(private storage: StorageService) {
    this.loadCategories();
  }

  /** Returns the live observable of all categories. */
  getCategories(): Observable<Category[]> {
    return this.categories$;
  }

  /** Returns a snapshot (sync) of the current categories. */
  getSnapshot(): Category[] {
    return this._categories();
  }

  /** Resolves the color for a category name; falls back to a neutral grey. */
  getColor(name: string): string {
    const cat = this._categories().find(c => c.name === name);
    return cat?.color ?? '#94a3b8';
  }

  /** Resolves the Ionicon name for a category; falls back to a generic icon. */
  getIcon(name: string): string {
    const cat = this._categories().find(c => c.name === name);
    return cat?.icon ?? 'pricetag-outline';
  }

  async addCategory(partial: Omit<Category, 'id'>): Promise<void> {
    const item: Category = { ...partial, id: this.uuid() };
    const updated = [...this._categories(), item];
    await this.save(updated);
  }

  async updateCategory(updated: Category): Promise<void> {
    const list = this._categories().map(c => c.id === updated.id ? updated : c);
    await this.save(list);
  }

  async deleteCategory(id: string): Promise<void> {
    const list = this._categories().filter(c => c.id !== id);
    await this.save(list);
  }

  private async loadCategories(): Promise<void> {
    let list = await this.storage.getList<Category>(KEY);
    if (!list.length) {
      // Seed defaults on first run
      list = DEFAULT_CATEGORIES.map(d => ({ ...d, id: this.uuid() }));
      await this.storage.saveList(KEY, list);
    }
    this._categories.set(list);
  }

  private async save(list: Category[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this._categories.set(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
