import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Expense, NewExpenseInput } from '../models';
import { CreditCardService } from './credit-card.service';
import { FinancialEngineService } from './financial-engine.service';
import { PendingNotificationQueueService } from './pending-notification-queue.service';
import { StorageService } from './storage.service';

describe('FinancialEngineService notification imports', () => {
  let data: Map<string, unknown>;

  const storageMock = {
    getList: async <T>(key: string): Promise<T[]> => (data.get(key) as T[] | undefined) ?? [],
    saveList: async <T>(key: string, list: T[]): Promise<void> => {
      data.set(key, list);
    },
    set: async (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
    },
    get: async <T>(key: string): Promise<T | null> => (data.get(key) as T | undefined) ?? null,
  };

  beforeEach(() => {
    data = new Map<string, unknown>();
    TestBed.configureTestingModule({
      providers: [
        FinancialEngineService,
        PendingNotificationQueueService,
        { provide: StorageService, useValue: storageMock },
        { provide: CreditCardService, useValue: { cards: signal([]) } },
      ],
    });
  });

  it('deduplicates concurrent expense saves and excludes pending queue records from totals', async () => {
    const engine = TestBed.inject(FinancialEngineService);
    const queue = TestBed.inject(PendingNotificationQueueService);
    await Promise.all([engine.loadAll(), queue.ready()]);
    const input: NewExpenseInput = {
      name: 'Wallet purchase',
      category: 'Food',
      amount: 103,
      date: '2026-10-20',
      paymentMethod: 'Credit Card',
      status: 'pending',
      recurring: false,
      notes: '',
      sourceNotificationFingerprint: 'wallet-fingerprint',
    };

    await Promise.all([engine.addExpense(input), engine.addExpense(input)]);
    const saved = data.get('expenses') as Expense[];
    expect(saved.length).toBe(1);

    const summaryBeforeCandidate = engine.summary();
    await queue.add({
      id: 'wallet-candidate',
      sourceApplication: 'com.google.android.apps.walletnfcrel',
      merchantName: 'Wallet purchase',
      amount: 103,
      currency: 'PHP',
      cardLabel: null,
      cardSuffix: null,
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      transactionTimestamp: null,
      fingerprint: 'candidate-only-fingerprint',
    });
    expect(engine.summary()).toEqual(summaryBeforeCandidate);
  });
});
