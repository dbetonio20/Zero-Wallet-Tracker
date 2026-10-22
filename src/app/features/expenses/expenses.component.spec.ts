import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { PendingNotificationCandidate } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { PendingNotificationQueueService } from '../../core/services/pending-notification-queue.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { WalletService } from '../../core/services/wallet.service';
import { ExpensesComponent } from './expenses.component';

describe('ExpensesComponent notification expense flow', () => {
  let fixture: ComponentFixture<ExpensesComponent>;
  let engine: jasmine.SpyObj<FinancialEngineService>;
  let queue: {
    pendingCandidates: () => PendingNotificationCandidate[];
    ready: jasmine.Spy;
    markImported: jasmine.Spy;
    notifyExpenseReviewFinished: jasmine.Spy;
  };

  const candidate: PendingNotificationCandidate = {
    id: 'wallet-1',
    sourceApplication: 'com.google.android.apps.walletnfcrel',
    merchantName: 'Dimsum Break SMSEASIDE P1',
    amount: 103,
    currency: 'PHP',
    cardLabel: 'EastWest Visa Gold',
    cardSuffix: '5008',
    notificationTimestamp: '2026-10-20T11:26:00.000Z',
    transactionTimestamp: null,
    fingerprint: 'wallet-fingerprint-1',
    reviewStatus: 'pending',
    importedAt: '2026-10-20T11:27:00.000Z',
  };

  beforeEach(async () => {
    engine = jasmine.createSpyObj<FinancialEngineService>(
      'FinancialEngineService',
      ['getExpenses', 'addExpense', 'updateExpense']
    );
    engine.getExpenses.and.returnValue(of([]));
    queue = {
      pendingCandidates: () => [candidate],
      ready: jasmine.createSpy('ready').and.resolveTo(undefined),
      markImported: jasmine.createSpy('markImported').and.resolveTo(undefined),
      notifyExpenseReviewFinished: jasmine.createSpy('notifyExpenseReviewFinished'),
    };

    await TestBed.configureTestingModule({
      imports: [ExpensesComponent],
      providers: [
        { provide: FinancialEngineService, useValue: engine },
        { provide: PreferencesService, useValue: {
          currentCurrencyCode: 'PHP',
          getUserName: async () => 'User',
          getUserInitial: () => 'U',
        } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: CategoryService, useValue: { getCategories: () => of([]) } },
        { provide: QuickAddService, useValue: { onTrigger$: new Subject<void>() } },
        { provide: CreditCardService, useValue: { getCards: () => of([]) } },
        { provide: PendingNotificationQueueService, useValue: queue },
        { provide: WalletService, useValue: { accounts: signal([]), getAccount: () => undefined } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ExpensesComponent);
  });

  it('keeps a candidate pending when the review form is dismissed', () => {
    const component = fixture.componentInstance;
    component.recordCandidate(candidate);

    expect(component.isModalOpen).toBeTrue();
    expect(component.form.name).toBe(candidate.merchantName ?? undefined);
    expect(component.form.amount).toBe(candidate.amount ?? undefined);
    expect(engine.addExpense).not.toHaveBeenCalled();
    expect(queue.markImported).not.toHaveBeenCalled();

    component.closeModal();

    expect(queue.pendingCandidates()).toContain(candidate);
    expect(queue.markImported).not.toHaveBeenCalled();
  });

  it('retains the candidate after an expense save failure for retry', async () => {
    engine.addExpense.and.rejectWith(new Error('Expense storage unavailable.'));
    const component = fixture.componentInstance;
    component.recordCandidate(candidate);
    component.form.category = 'Food';
    component.form.date = '2026-10-20';

    await component.save();

    expect(component.saveError).toContain('Expense storage unavailable.');
    expect(queue.markImported).not.toHaveBeenCalled();
    expect(queue.pendingCandidates()).toContain(candidate);
  });

  it('saves the expense before marking its candidate imported', async () => {
    engine.addExpense.and.resolveTo(undefined);
    const component = fixture.componentInstance;
    component.recordCandidate(candidate);
    component.form.category = 'Food';
    component.form.date = '2026-10-20';

    await component.save();

    expect(engine.addExpense).toHaveBeenCalledWith(jasmine.objectContaining({
      amount: 103,
      category: 'Food',
      sourceNotificationFingerprint: candidate.fingerprint,
    }));
    expect(queue.markImported).toHaveBeenCalledWith(candidate.id);
    expect(component.isModalOpen).toBeFalse();
  });
});
