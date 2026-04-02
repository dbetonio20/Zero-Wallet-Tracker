import { Injectable, inject, signal } from '@angular/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { firestoreDb } from '../config/firebase.config';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';

/** All storage keys that are synced to Firestore. */
const SYNC_KEYS = [
  'expenses',
  'incomes',
  'installments',
  'installmentPayments',
  'paymentAllocations',
  'credit_cards',
  'categories',
  'savingsGoals',
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  /**
   * Whether a pull operation is in progress.
   * Suppresses the storage-save callback during pullAll to avoid
   * immediately pushing the data we just pulled from Firestore.
   */
  private suppressSync = false;

  /** Set when a background Firestore push fails. Cleared on next successful push. */
  readonly syncError = signal<string | null>(null);

  constructor() {
    // Register a callback on StorageService so every saveList() call
    // automatically pushes the updated collection to Firestore in the background.
    this.storage.registerSyncCallback((key, data) => {
      if (this.suppressSync) return;
      if (!(SYNC_KEYS as readonly string[]).includes(key)) return;
      const uid = this.auth.currentUser()?.uid;
      if (!uid) return;
      this.pushKey(uid, key, data)
        .then(() => this.syncError.set(null))
        .catch(err => {
          const msg = err instanceof Error ? err.message : 'Cloud sync failed';
          this.syncError.set(msg);
          console.warn('[SyncService] background push failed', err);
        });
    });
  }

  /**
   * Checks whether the given user has any data in Firestore.
   * Uses the 'expenses' document as an indicator — cheapest single-doc read.
   */
  async checkCloudHasData(uid: string): Promise<boolean> {
    const snap = await getDoc(doc(firestoreDb, `users/${uid}/data/expenses`));
    return snap.exists();
  }

  /**
   * Checks whether local storage has any financial data.
   * Returns true as soon as any synced collection has at least one item.
   */
  async checkLocalHasData(): Promise<boolean> {
    for (const key of SYNC_KEYS) {
      const items = await this.storage.getList(key);
      if (items.length > 0) return true;
    }
    return false;
  }

  /**
   * Pushes a single collection to Firestore.
   * Path: `users/{uid}/data/{key}` → `{ items: [ ... ] }`
   */
  async pushKey(uid: string, key: string, data: unknown[]): Promise<void> {
    const ref = doc(firestoreDb, `users/${uid}/data/${key}`);
    await setDoc(ref, { items: data });
  }

  /**
   * Pulls all synced collections from Firestore and writes them to local storage.
   * Suppresses the sync callback during the operation to avoid a push loop.
   */
  async pullAll(uid: string): Promise<void> {
    this.suppressSync = true;
    try {
      for (const key of SYNC_KEYS) {
        const snap = await getDoc(doc(firestoreDb, `users/${uid}/data/${key}`));
        if (snap.exists()) {
          const items = (snap.data()['items'] as unknown[]) ?? [];
          await this.storage.saveList(key, items);
        }
      }
    } finally {
      this.suppressSync = false;
    }
  }

  /**
   * Reads all synced collections from local storage and pushes them to Firestore.
   * Used on first sign-in when the cloud is empty.
   */
  async pushAll(uid: string): Promise<void> {
    for (const key of SYNC_KEYS) {
      const data = await this.storage.getList(key);
      await this.pushKey(uid, key, data);
    }
  }
}
