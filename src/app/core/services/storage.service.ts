import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

/** Callback type registered by SyncService to push data after each saveList. */
type SyncCallback = (key: string, data: unknown[]) => void;

@Injectable({ providedIn: 'root' })
export class StorageService {
  private _storage: Storage | null = null;
  private ready$ = new BehaviorSubject<boolean>(false);
  private syncCallback?: SyncCallback;

  constructor(private storage: Storage) {
    this.init();
  }

  private async init() {
    const storage = await this.storage.create();
    this._storage = storage;
    this.ready$.next(true);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.waitReady();
    await this._storage?.set(key, value);
  }

  async get<T>(key: string): Promise<T | null> {
    await this.waitReady();
    return (await this._storage?.get(key)) ?? null;
  }

  async remove(key: string): Promise<void> {
    await this.waitReady();
    await this._storage?.remove(key);
  }

  // Generic helpers for arrays
  async getList<T>(key: string): Promise<T[]> {
    const data = await this.get<T[]>(key);
    return data ?? [];
  }

  async saveList<T>(key: string, list: T[]): Promise<void> {
    await this.set(key, list);
    this.syncCallback?.(key, list as unknown[]);
  }

  /**
   * Registers a callback invoked after every successful saveList() call.
   * Used by SyncService to push changes to Firestore without creating a
   * circular dependency (SyncService → StorageService, never the reverse).
   */
  registerSyncCallback(cb: SyncCallback): void {
    this.syncCallback = cb;
  }

  private waitReady(): Promise<void> {
    return new Promise(resolve => {
      if (this.ready$.value) { resolve(); return; }
      const sub = this.ready$.subscribe(r => {
        if (r) { sub.unsubscribe(); resolve(); }
      });
    });
  }
}
