import { TestBed } from '@angular/core/testing';
import { PendingNotificationCandidate } from '../models';
import { StorageService } from './storage.service';
import {
  NewPendingNotification,
  PendingNotificationQueueService,
} from './pending-notification-queue.service';

describe('PendingNotificationQueueService', () => {
  let queue: PendingNotificationQueueService;
  let data: Map<string, unknown>;
  let failNextListWrite: boolean;
  let saveOptions: Array<{ sync?: boolean } | undefined>;

  const storageMock = {
    getList: async <T>(key: string): Promise<T[]> => (data.get(key) as T[] | undefined) ?? [],
    get: async <T>(key: string): Promise<T | null> => (data.get(key) as T | undefined) ?? null,
    set: async (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
    },
    saveList: async <T>(
      key: string,
      list: T[],
      options?: { sync?: boolean }
    ): Promise<void> => {
      saveOptions.push(options);
      if (failNextListWrite) {
        failNextListWrite = false;
        throw new Error('Storage write failed.');
      }
      data.set(key, list);
    },
  };

  const candidate: NewPendingNotification = {
    id: 'wallet-1',
    sourceApplication: 'com.google.android.apps.walletnfcrel',
    merchantName: 'Dimsum Break',
    amount: 103,
    currency: 'PHP',
    cardLabel: 'EastWest Visa Gold',
    cardSuffix: '5008',
    notificationTimestamp: '2026-10-20T11:26:00.000Z',
    transactionTimestamp: null,
    fingerprint: 'fingerprint-1',
  };

  beforeEach(async () => {
    data = new Map<string, unknown>();
    failNextListWrite = false;
    saveOptions = [];
    TestBed.configureTestingModule({
      providers: [
        PendingNotificationQueueService,
        { provide: StorageService, useValue: storageMock },
      ],
    });

    queue = TestBed.inject(PendingNotificationQueueService);
    await queue.ready();
  });

  it('re-surfaces a pending candidate without adding a duplicate', async () => {
    await queue.add(candidate);
    const emitted: string[] = [];
    const subscription = queue.candidateAdded$.subscribe(item => emitted.push(item.id));

    expect(await queue.add(candidate)).toBeFalse();
    expect(queue.resurfacePending(candidate.fingerprint)).toBeTrue();
    expect(emitted).toEqual([candidate.id]);
    expect(queue.pendingCandidates().length).toBe(1);

    subscription.unsubscribe();
  });

  it('persists candidates locally and deduplicates across service restarts', async () => {
    expect(await queue.add(candidate)).toBeTrue();
    expect(saveOptions.at(-1)?.sync).toBeFalse();
    expect(queue.pendingCount()).toBe(1);

    const reloaded = TestBed.runInInjectionContext(
      () => new PendingNotificationQueueService(storageMock as unknown as StorageService)
    );
    await reloaded.ready();
    expect(await reloaded.add(candidate)).toBeFalse();
    expect(reloaded.pendingCount()).toBe(1);
  });

  it('announces a new candidate once for immediate review', async () => {
    const received: PendingNotificationCandidate[] = [];
    queue.candidateAdded$.subscribe(item => received.push(item));

    expect(await queue.add(candidate)).toBeTrue();
    expect(await queue.add(candidate)).toBeFalse();
    expect(received).toEqual([jasmine.objectContaining({ id: candidate.id })]);
  });

  it('keeps skipped candidates out of review and blocks redelivery', async () => {
    await queue.add(candidate);
    await queue.skip(candidate.id);

    expect(queue.pendingCount()).toBe(0);
    expect(queue.candidates()[0].reviewStatus).toBe('ignored');
    expect(await queue.add(candidate)).toBeFalse();
  });

  it('clears active candidates without forgetting their deduplication fingerprints', async () => {
    await queue.add(candidate);
    await queue.clearPending();

    expect(queue.pendingCandidates()).toEqual([]);
    expect(await queue.add(candidate)).toBeFalse();
  });

  it('hands off a one-time expense review request', () => {
    queue.requestExpenseReview(candidate.id);

    expect(queue.takeExpenseReviewRequest()).toBe(candidate.id);
    expect(queue.takeExpenseReviewRequest()).toBeNull();
  });

  it('allows retry after a storage failure without losing the candidate', async () => {
    failNextListWrite = true;

    await expectAsync(queue.add(candidate)).toBeRejectedWithError('Storage write failed.');
    expect(queue.pendingCount()).toBe(0);
    expect(await queue.add(candidate)).toBeTrue();
    expect(queue.pendingCount()).toBe(1);
  });

  it('updates and removes candidates while preserving their fingerprints', async () => {
    await queue.add(candidate);
    const storedCandidate = queue.candidates()[0] as PendingNotificationCandidate;
    await queue.update({ ...storedCandidate, merchantName: 'Corrected merchant' });

    expect(queue.candidates()[0].merchantName).toBe('Corrected merchant');
    await queue.remove(candidate.id);
    expect(queue.candidates()).toEqual([]);
    expect(await queue.add(candidate)).toBeFalse();
  });
});
