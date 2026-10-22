import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { PendingNotificationCandidate } from '../models';
import { StorageService } from './storage.service';

const CANDIDATES_KEY = 'wallet_pending_candidates';
const FINGERPRINTS_KEY = 'wallet_notification_fingerprints';

export interface NewPendingNotification {
  id: string;
  sourceApplication: string;
  merchantName: string | null;
  amount: number | null;
  currency: string | null;
  cardLabel: string | null;
  cardSuffix: string | null;
  notificationTimestamp: string;
  transactionTimestamp: string | null;
  fingerprint: string;
}

@Injectable({ providedIn: 'root' })
export class PendingNotificationQueueService {
  private readonly _candidates = signal<PendingNotificationCandidate[]>([]);
  private readonly _loadError = signal('');
  private readonly candidateAdded = new Subject<PendingNotificationCandidate>();
  private readonly expenseReviewFinished = new Subject<void>();
  private readonly _pendingCandidates = computed(() =>
    this._candidates().filter(candidate => candidate.reviewStatus === 'pending')
  );
  private readonly fingerprints = new Set<string>();
  private loadPromise: Promise<void> | null = null;
  private expenseReviewRequestId: string | null = null;
  private expenseReviewReturnUrl: string | null = null;

  readonly candidates = this._candidates.asReadonly();
  readonly pendingCandidates = this._pendingCandidates;
  readonly pendingCount = computed(() => this._pendingCandidates().length);
  readonly pendingCandidates$ = toObservable(this._pendingCandidates);
  readonly loadError = this._loadError.asReadonly();
  readonly candidateAdded$ = this.candidateAdded.asObservable();
  readonly expenseReviewFinished$ = this.expenseReviewFinished.asObservable();

  constructor(private readonly storage: StorageService) {
    void this.ensureLoaded().catch(error => this.setLoadError(error));
  }

  /** Loads the local-only queue before returning a snapshot. */
  async ready(): Promise<void> {
    await this.ensureLoaded();
  }

  /** Requests that the Expenses page open its confirmation form for a pending candidate. */
  requestExpenseReview(id: string, returnUrl: string | null = null): void {
    this.expenseReviewRequestId = id;
    this.expenseReviewReturnUrl = returnUrl;
  }

  /** Consumes the one-time request to open an expense confirmation form. */
  takeExpenseReviewRequest(): string | null {
    const id = this.expenseReviewRequestId;
    this.expenseReviewRequestId = null;
    return id;
  }

  /** Consumes the route the review was opened from, so the user can return to it. */
  takeExpenseReviewReturnUrl(): string | null {
    const url = this.expenseReviewReturnUrl;
    this.expenseReviewReturnUrl = null;
    return url;
  }

  /** Cancels a review request if navigation to Expenses did not succeed. */
  cancelExpenseReviewRequest(id: string): void {
    if (this.expenseReviewRequestId === id) {
      this.expenseReviewRequestId = null;
      this.expenseReviewReturnUrl = null;
    }
  }

  /** Notifies the app shell that the expense confirmation form has closed. */
  notifyExpenseReviewFinished(): void {
    this.expenseReviewFinished.next();
  }

  /** Adds a notification candidate once, using its stable fingerprint for deduplication. */
  async add(candidate: NewPendingNotification): Promise<boolean> {
    await this.ensureLoaded();
    if (
      this.fingerprints.has(candidate.fingerprint) ||
      this._candidates().some(item => item.fingerprint === candidate.fingerprint)
    ) {
      return false;
    }

    const updated = [
      {
        ...candidate,
        reviewStatus: 'pending' as const,
        importedAt: new Date().toISOString(),
      },
      ...this._candidates(),
    ];
    this.fingerprints.add(candidate.fingerprint);
    try {
      await this.save(updated);
    } catch (error) {
      if (!this._candidates().some(item => item.fingerprint === candidate.fingerprint)) {
        this.fingerprints.delete(candidate.fingerprint);
      }
      throw error;
    }
    this.candidateAdded.next(updated[0]);
    return true;
  }

  /** Moves a previously skipped candidate back into pending review when its notification is active again. */
  async reactivateIgnored(fingerprint: string): Promise<boolean> {
    await this.ensureLoaded();
    const existing = this._candidates().find(
      item => item.fingerprint === fingerprint && item.reviewStatus === 'ignored'
    );
    if (!existing) return false;
    await this.updateStatus(existing.id, 'pending');
    return true;
  }

  /** Re-surfaces a still-pending candidate for review when its notification is seen again. */
  resurfacePending(fingerprint: string): boolean {
    const existing = this._candidates().find(
      item => item.fingerprint === fingerprint && item.reviewStatus === 'pending'
    );
    if (!existing) return false;
    this.candidateAdded.next(existing);
    return true;
  }

  /** Updates a stored candidate without changing its review state. */
  async update(candidate: PendingNotificationCandidate): Promise<void> {
    await this.ensureLoaded();
    const existing = this._candidates().find(item => item.id === candidate.id);
    if (!existing) throw new Error('The pending notification candidate no longer exists.');
    if (
      candidate.fingerprint !== existing.fingerprint &&
      this.fingerprints.has(candidate.fingerprint)
    ) {
      throw new Error('Another notification already has this fingerprint.');
    }
    this.fingerprints.add(candidate.fingerprint);
    await this.save(
      this._candidates().map(item => (item.id === candidate.id ? candidate : item))
    );
  }

  /** Removes a candidate but retains its fingerprint to prevent immediate re-delivery. */
  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    await this.save(this._candidates().filter(candidate => candidate.id !== id));
  }

  /** Marks a candidate ignored without creating or changing an expense. */
  async skip(id: string): Promise<void> {
    await this.updateStatus(id, 'ignored');
  }

  /** Marks a candidate imported after the corresponding expense has been saved. */
  async markImported(id: string): Promise<void> {
    await this.updateStatus(id, 'imported');
  }

  /** Removes all active candidates while preserving fingerprints to prevent immediate re-imports. */
  async clearPending(): Promise<void> {
    await this.ensureLoaded();
    const updated = this._candidates().filter(candidate => candidate.reviewStatus !== 'pending');
    await this.save(updated);
  }

  private async updateStatus(
    id: string,
    reviewStatus: PendingNotificationCandidate['reviewStatus']
  ): Promise<void> {
    await this.ensureLoaded();
    const updated = this._candidates().map(candidate =>
      candidate.id === id ? { ...candidate, reviewStatus } : candidate
    );
    await this.save(updated);
  }

  private async save(candidates: PendingNotificationCandidate[]): Promise<void> {
    await this.storage.saveList(CANDIDATES_KEY, candidates, { sync: false });
    this._candidates.set(candidates);
    await this.storage.set(FINGERPRINTS_KEY, [...this.fingerprints]);
    this._loadError.set('');
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    const [candidates, fingerprints] = await Promise.all([
      this.storage.getList<PendingNotificationCandidate>(CANDIDATES_KEY),
      this.storage.get<string[]>(FINGERPRINTS_KEY),
    ]);
    for (const candidate of candidates) this.fingerprints.add(candidate.fingerprint);
    for (const fingerprint of fingerprints ?? []) this.fingerprints.add(fingerprint);
    this._candidates.set(candidates);
    this._loadError.set('');
  }

  private setLoadError(error: unknown): void {
    this._loadError.set(
      error instanceof Error ? error.message : 'Could not load pending notification transactions.'
    );
    this.loadPromise = null;
  }
}
