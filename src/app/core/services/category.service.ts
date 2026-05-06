import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  Category,
  DEFAULT_CATEGORIES,
  NewCategoryInput,
  createSyncedEntity,
  filterActiveSyncedEntities,
  normalizeSyncedEntity,
  tombstoneSyncedEntity,
  touchSyncedEntity,
} from '../models';
import { StorageService } from './storage.service';

const KEY = 'categories';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly _allCategories = signal<Category[]>([]);

  /** Read-only signal — use directly in templates or computed(). */
  readonly categories = computed(() => filterActiveSyncedEntities(this._allCategories()));

  /** Observable alias for async-pipe consumers. */
  readonly categories$ = toObservable(this.categories);

  constructor(private storage: StorageService) {
    this.loadCategories();
  }

  /** Returns the live observable of all categories. */
  getCategories(): Observable<Category[]> {
    return this.categories$;
  }

  /** Returns a snapshot (sync) of the current categories. */
  getSnapshot(): Category[] {
    return this.categories();
  }

  /** Resolves the color for a category name; falls back to a neutral grey. */
  getColor(name: string): string {
    const cat = this.categories().find(c => c.name === name);
    return cat?.color ?? '#94a3b8';
  }

  /** Resolves the Ionicon name for a category; falls back to a generic icon. */
  getIcon(name: string): string {
    const cat = this.categories().find(c => c.name === name);
    return cat?.icon ?? 'pricetag-outline';
  }

  async addCategory(partial: NewCategoryInput): Promise<void> {
    const item: Category = createSyncedEntity({ ...partial, id: this.uuid() });
    const updated = [...this._allCategories(), item];
    await this.save(updated);
  }

  async updateCategory(updated: Category): Promise<void> {
    const list = this._allCategories().map(category =>
      category.id === updated.id
        ? touchSyncedEntity({ ...category, ...updated, createdAt: category.createdAt })
        : category
    );
    await this.save(list);
  }

  async deleteCategory(id: string): Promise<void> {
    const list = this._allCategories().map(category =>
      category.id === id ? tombstoneSyncedEntity(category) : category
    );
    await this.save(list);
  }

  private async loadCategories(): Promise<void> {
    let list = await this.storage.getList<Category>(KEY);
    if (!list.length) {
      // Seed defaults on first run
      list = DEFAULT_CATEGORIES.map(defaultCategory =>
        createSyncedEntity({ ...defaultCategory, id: this.uuid() })
      );
      await this.storage.saveList(KEY, list);
    } else {
      list = list.map(category => normalizeSyncedEntity(category));
    }
    this._allCategories.set(list);
  }

  private async save(list: Category[]): Promise<void> {
    await this.storage.saveList(KEY, list);
    this._allCategories.set(list);
  }

  private uuid(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
}
