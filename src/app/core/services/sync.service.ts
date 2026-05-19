import { Injectable, effect, inject, signal } from '@angular/core';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { firestoreDb } from '../config/firebase.config';
import {
  SyncMetadata,
  SyncWarning,
  isSyncedEntityDeleted,
  normalizeSyncedEntity,
  tombstoneSyncedEntity,
} from '../models';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CreditCardService } from './credit-card.service';
import { FinancialEngineService } from './financial-engine.service';
import { SavingsGoalService } from './savings-goal.service';
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

const TOMBSTONE_RETENTION_DAYS = 60;

type SyncKey = (typeof SYNC_KEYS)[number];

interface MergeSyncedRecordsResult<T extends { id: string } & SyncMetadata> {
  merged: T[];
  warnings: SyncWarning[];
}

interface CompactionReport {
  scanned: number;
  compacted: number;
  failed: number;
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly engine = inject(FinancialEngineService);
  private readonly cardService = inject(CreditCardService);
  private readonly categoryService = inject(CategoryService);
  private readonly goalService = inject(SavingsGoalService);
  private readonly keyUnsubscribers = new Map<SyncKey, () => void>();
  private activeUid: string | null = null;
  private compactionInFlight = false;

  /**
   * Whether a pull operation is in progress.
   * Suppresses the storage-save callback during pullAll to avoid
   * immediately pushing the data we just pulled from Firestore.
   */
  private suppressSync = false;

  /**
   * Counts in-flight local pushes per key. While > 0, snapshot-triggered
   * reloadFromStorage is skipped so intermediate Firestore snapshots (fired
   * during our own push) cannot overwrite in-memory signal state.
   */
  private readonly pushInFlight = new Map<string, number>();

  /** Set when a background Firestore push fails. Cleared on next successful push. */
  readonly syncError = signal<string | null>(null);

  /** Non-blocking sync/import warnings surfaced by metadata normalization. */
  readonly syncWarnings = signal<SyncWarning[]>([]);

  /** Timestamp (ISO) of the last successful compaction pass. */
  readonly lastCompactionAt = signal<string | null>(null);

  constructor() {
    effect(() => {
      const uid = this.auth.currentUser()?.uid ?? null;
      this.bindRealtimeSync(uid).catch(err => {
        const msg = err instanceof Error ? err.message : 'Cloud sync failed';
        this.syncError.set(msg);
      });
    });

    // Register a callback on StorageService so every saveList() call
    // automatically pushes the updated collection to Firestore in the background.
    this.storage.registerSyncCallback((key, data) => {
      if (this.suppressSync) return;
      if (!this.isSyncKey(key)) return;
      const uid = this.auth.currentUser()?.uid;
      if (!uid) return;
      // Increment counter so the snapshot handler skips reloadFromStorage
      // while our own writes are still in flight (prevents intermediate
      // Firestore snapshots from reverting local UI state).
      this.pushInFlight.set(key, (this.pushInFlight.get(key) ?? 0) + 1);
      this.pushKey(uid, key, data as RawSyncedRecord[])
        .then(() => this.syncError.set(null))
        .catch(err => {
          const msg = err instanceof Error ? err.message : 'Cloud sync failed';
          this.syncError.set(msg);
          console.warn('[SyncService] background push failed', err);
        })
        .finally(() => {
          const count = (this.pushInFlight.get(key) ?? 1) - 1;
          if (count <= 0) {
            this.pushInFlight.delete(key);
          } else {
            this.pushInFlight.set(key, count);
          }
        });
    });
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
   * Pushes a single collection to Firestore as per-record documents.
   * Path: `users/{uid}/{key}/{recordId}`
   * Tombstoned records (deletedAt set) are hard-deleted from Firestore immediately.
   * Non-deleted records are upserted; writes are queued offline and synced when reconnected.
   */
  async pushKey(uid: string, key: SyncKey, data: RawSyncedRecord[]): Promise<void> {
    const normalizedRecords = data.map(record => this.normalizeRecord(record));

    for (const record of normalizedRecords) {
      const ref = doc(firestoreDb, `users/${uid}/${key}/${record.id}`);
      if (isSyncedEntityDeleted(record)) {
        await deleteDoc(ref);
      } else {
        await setDoc(
          ref,
          {
            ...record,
            serverUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  }

  /**
   * Reads all synced collections from local storage and pushes them to Firestore.
   * Used to initialize the cloud account with local data.
   * setDoc is used so writes are queued offline and flushed when online.
   */
  async pushAll(uid: string): Promise<void> {
    for (const key of SYNC_KEYS) {
      const data = await this.storage.getList<RawSyncedRecord>(key);
      await this.pushKey(uid, key, data);
    }
  }

  /**
   * Forces a full bidirectional sync: restarts all real-time Firestore listeners
   * (pull) and pushes the entire local dataset up to Firestore (push).
   * Safe to call at any time while logged in.
   */
  async forceSync(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    // Restart listeners to immediately pull latest remote state.
    this.stopAllListeners();
    this.activeUid = null; // reset so bindRealtimeSync doesn't short-circuit
    for (const key of SYNC_KEYS) {
      this.startKeyListener(uid, key);
    }
    this.activeUid = uid;

    // Push local data up so any missing records are sent to Firestore.
    await this.pushAll(uid);
    this.syncError.set(null);
  }

  private async bindRealtimeSync(uid: string | null): Promise<void> {
    if (uid === this.activeUid) return;

    this.stopAllListeners();
    this.activeUid = uid;

    if (!uid) return;

    for (const key of SYNC_KEYS) {
      this.startKeyListener(uid, key);
    }

    await this.runSafeCompaction();
  }

  private startKeyListener(uid: string, key: SyncKey): void {
    const ref = collection(firestoreDb, `users/${uid}/${key}`);
    const unsubscribe = onSnapshot(
      ref,
      async snapshot => {
        const remoteRecords = snapshot.docs.map(snap =>
          this.normalizeRecord({
            id: snap.id,
            ...(snap.data() as Record<string, unknown>),
          })
        );

        const localRecords = (await this.storage.getList<RawSyncedRecord>(key)).map(record =>
          this.normalizeRecord(record)
        );

        const mergeResult = this.mergeSyncedRecords(localRecords, remoteRecords, key);
        this.appendWarnings(mergeResult.warnings);

        await this.runWithSuppressedSync(async () => {
          await this.storage.saveList(key, mergeResult.merged);
        });

        // Skip reloading signals if we triggered this snapshot ourselves via a
        // local push — the in-memory signals already have the correct state and
        // reloading from storage at this point would revert optimistic UI updates.
        if (!this.pushInFlight.has(key)) {
          // Update in-memory signals so the UI reflects the merged state immediately
          // (covers deletions propagated from other devices / sessions).
          await this.engine.reloadFromStorage(key);
          await this.reloadServiceSignal(key);
        }

        this.syncError.set(null);
      },
      err => {
        const msg = err instanceof Error ? err.message : 'Cloud sync failed';
        this.syncError.set(msg);
      }
    );

    this.keyUnsubscribers.set(key, unsubscribe);
  }

  /**
   * Reloads in-memory signals for collections managed outside FinancialEngineService.
   * Called after each Firestore snapshot merge so remote deletes propagate to the UI.
   */
  private async reloadServiceSignal(key: string): Promise<void> {
    switch (key) {
      case 'credit_cards':
        await this.cardService.reloadFromStorage();
        break;
      case 'categories':
        await this.categoryService.reloadFromStorage();
        break;
      case 'savingsGoals':
        await this.goalService.reloadFromStorage();
        break;
    }
  }

  private stopAllListeners(): void {
    for (const unsubscribe of this.keyUnsubscribers.values()) {
      unsubscribe();
    }
    this.keyUnsubscribers.clear();
  }

  private async runWithSuppressedSync(task: () => Promise<void>): Promise<void> {
    this.suppressSync = true;
    try {
      await task();
    } finally {
      this.suppressSync = false;
    }
  }

  mergeSyncedRecords<T extends { id: string } & SyncMetadata>(
    currentRecords: readonly T[],
    incomingRecords: readonly T[],
    entityType: string
  ): MergeSyncedRecordsResult<T> {
    const warnings: SyncWarning[] = [];
    const merged = new Map<string, T>();
    const remoteIds = new Set(incomingRecords.map(r => r.id));

    for (const record of currentRecords) {
      merged.set(record.id, record);
    }

    for (const record of incomingRecords) {
      if (!record.serverUpdatedAt) {
        warnings.push({
          code: 'missing-server-updated-at',
          entityType,
          recordId: record.id,
          message: `${entityType} ${record.id} is missing serverUpdatedAt; falling back to updatedAt authority.`,
        });
      }

      const existing = merged.get(record.id);
      if (!existing) {
        merged.set(record.id, record);
        continue;
      }

      if (this.compareSyncedRecords(record, existing) >= 0) {
        merged.set(record.id, record);
      }
    }

    // Any local record that was previously synced to Firestore (serverUpdatedAt set)
    // but is no longer present in the remote snapshot was hard-deleted from Firestore
    // (either by our deleteDoc call or by another device). Tombstone it locally so it
    // is filtered out by filterActiveSyncedEntities and does not reappear after restart.
    for (const [id, record] of merged.entries()) {
      if (!remoteIds.has(id) && record.serverUpdatedAt !== null && !isSyncedEntityDeleted(record)) {
        merged.set(id, tombstoneSyncedEntity(record));
      }
    }

    return {
      merged: Array.from(merged.values()),
      warnings,
    };
  }

  compareSyncedRecords<T extends { id: string } & SyncMetadata>(left: T, right: T): number {
    // Tombstone always beats an active record, regardless of timestamp.
    // Once a record is deleted it must stay deleted even if another device
    // later modified the same record with a newer serverUpdatedAt.
    if (isSyncedEntityDeleted(left) !== isSyncedEntityDeleted(right)) {
      return isSyncedEntityDeleted(left) ? 1 : -1;
    }

    // Compare by the best available timestamp. Use serverUpdatedAt when available
    // (it reflects the authoritative server time), otherwise fall back to updatedAt.
    // This means a locally-modified record (updatedAt only) can beat an older remote
    // record that has serverUpdatedAt set — preventing stale Firestore data from
    // overwriting fresh local writes before they've been pushed to the server.
    const leftTime = left.serverUpdatedAt ?? left.updatedAt ?? left.createdAt;
    const rightTime = right.serverUpdatedAt ?? right.updatedAt ?? right.createdAt;
    return this.compareIsoTimestamps(leftTime, rightTime);
  }

  canCompactTombstone(
    record: Pick<SyncMetadata, 'deletedAt' | 'serverUpdatedAt'>,
    now = new Date()
  ): boolean {
    if (!record.deletedAt) return false;

    const deletedAt = Date.parse(record.deletedAt);
    if (Number.isNaN(deletedAt)) return false;

    const ageInDays = (now.getTime() - deletedAt) / (1000 * 60 * 60 * 24);
    return ageInDays >= TOMBSTONE_RETENTION_DAYS && record.serverUpdatedAt !== null;
  }

  async runSafeCompaction(now = new Date()): Promise<CompactionReport> {
    if (this.compactionInFlight) {
      return { scanned: 0, compacted: 0, failed: 0 };
    }

    const uid = this.auth.currentUser()?.uid;
    if (!uid) {
      return { scanned: 0, compacted: 0, failed: 0 };
    }

    this.compactionInFlight = true;

    try {
      let scanned = 0;
      let compacted = 0;
      let failed = 0;

      for (const key of SYNC_KEYS) {
        const records = (await this.storage.getList<RawSyncedRecord>(key)).map(record =>
          this.normalizeRecord(record)
        );
        const compactable = records.filter(record => this.canCompactTombstone(record, now));
        scanned += compactable.length;
        if (compactable.length === 0) continue;

        const failedIds = new Set<string>();

        for (const record of compactable) {
          try {
            await deleteDoc(doc(firestoreDb, `users/${uid}/${key}/${record.id}`));
            compacted += 1;
          } catch {
            failed += 1;
            failedIds.add(record.id);
            this.appendWarnings([
              {
                code: 'best-effort-skip',
                entityType: key,
                recordId: record.id,
                message: `Compaction skipped ${key} ${record.id} because the remote delete failed.`,
              },
            ]);
          }
        }

        const remaining = records.filter(record =>
          !compactable.some(compactableRecord => compactableRecord.id === record.id) ||
          failedIds.has(record.id)
        );

        await this.runWithSuppressedSync(async () => {
          await this.storage.saveList(key, remaining);
        });
      }

      this.lastCompactionAt.set(now.toISOString());
      return { scanned, compacted, failed };
    } finally {
      this.compactionInFlight = false;
    }
  }

  /**
   * Deletes every record in all synced Firestore collections for the given user.
   * Must be called before clearing local storage so the IDs are still available.
   * After this completes, signing back in will NOT restore the deleted data.
   */
  async wipeFirestoreData(uid: string): Promise<void> {
    this.stopAllListeners();
    this.suppressSync = true;
    try {
      for (const key of SYNC_KEYS) {
        const colRef = collection(firestoreDb, `users/${uid}/${key}`);
        const snapshot = await getDocs(colRef);
        for (const docSnap of snapshot.docs) {
          try {
            await deleteDoc(docSnap.ref);
          } catch {
            // best-effort — don't block the wipe if a single delete fails
          }
        }
      }
    } finally {
      this.suppressSync = false;
    }
  }

  appendWarnings(warnings: SyncWarning[]): void {
    if (warnings.length === 0) return;
    this.syncWarnings.update(currentWarnings => [...currentWarnings, ...warnings]);
  }

  clearWarnings(): void {
    this.syncWarnings.set([]);
  }

  private getRecordAuthority(record: SyncMetadata): number {
    if (record.serverUpdatedAt) return 3;
    if (record.updatedAt) return 2;
    return 1;
  }

  private getAuthorityTimestamp(record: SyncMetadata): string {
    return record.serverUpdatedAt ?? record.updatedAt ?? record.createdAt;
  }

  private compareIsoTimestamps(left: string, right: string): number {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);

    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return -1;
    if (Number.isNaN(rightTime)) return 1;

    return leftTime - rightTime;
  }

  private normalizeRecord(record: RawSyncedRecord): NormalizedSyncedRecord {
    const normalized = normalizeSyncedEntity(record);
    return {
      ...normalized,
      createdAt: this.toIsoString(normalized.createdAt) ?? normalized.createdAt,
      updatedAt: this.toIsoString(normalized.updatedAt) ?? normalized.updatedAt,
      serverUpdatedAt: this.toIsoString(normalized.serverUpdatedAt),
      deletedAt: this.toIsoString(normalized.deletedAt),
    };
  }

  private isSyncKey(value: string): value is SyncKey {
    return (SYNC_KEYS as readonly string[]).includes(value);
  }

  private toIsoString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const maybeTimestamp = value as { toDate: () => Date };
      return maybeTimestamp.toDate().toISOString();
    }
    return null;
  }
}

type RawSyncedRecord = { id: string } & Partial<SyncMetadata> & Record<string, unknown>;
type NormalizedSyncedRecord = { id: string } & SyncMetadata & Record<string, unknown>;
