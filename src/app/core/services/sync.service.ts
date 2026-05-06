import { Injectable, effect, inject, signal } from '@angular/core';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { firestoreDb } from '../config/firebase.config';
import {
  SyncMetadata,
  SyncWarning,
  normalizeSyncedEntity,
  isSyncedEntityDeleted,
} from '../models';
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
  private readonly keyUnsubscribers = new Map<SyncKey, () => void>();
  private activeUid: string | null = null;
  private compactionInFlight = false;

  /**
   * Whether a pull operation is in progress.
   * Suppresses the storage-save callback during pullAll to avoid
   * immediately pushing the data we just pulled from Firestore.
   */
  private suppressSync = false;

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
      this.pushKey(uid, key, data as RawSyncedRecord[])
        .then(() => this.syncError.set(null))
        .catch(err => {
          const msg = err instanceof Error ? err.message : 'Cloud sync failed';
          this.syncError.set(msg);
          console.warn('[SyncService] background push failed', err);
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
   * setDoc queues writes offline and syncs automatically when reconnected.
   */
  async pushKey(uid: string, key: SyncKey, data: RawSyncedRecord[]): Promise<void> {
    const normalizedRecords = data.map(record => this.normalizeRecord(record));

    for (const record of normalizedRecords) {
      const ref = doc(firestoreDb, `users/${uid}/${key}/${record.id}`);
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

        this.syncError.set(null);
      },
      err => {
        const msg = err instanceof Error ? err.message : 'Cloud sync failed';
        this.syncError.set(msg);
      }
    );

    this.keyUnsubscribers.set(key, unsubscribe);
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

    return {
      merged: Array.from(merged.values()),
      warnings,
    };
  }

  compareSyncedRecords<T extends { id: string } & SyncMetadata>(left: T, right: T): number {
    const leftAuthority = this.getRecordAuthority(left);
    const rightAuthority = this.getRecordAuthority(right);

    if (leftAuthority !== rightAuthority) {
      return leftAuthority - rightAuthority;
    }

    const timestampComparison = this.compareIsoTimestamps(
      this.getAuthorityTimestamp(left),
      this.getAuthorityTimestamp(right)
    );
    if (timestampComparison !== 0) {
      return timestampComparison;
    }

    if (isSyncedEntityDeleted(left) !== isSyncedEntityDeleted(right)) {
      return isSyncedEntityDeleted(left) ? 1 : -1;
    }

    return 0;
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
