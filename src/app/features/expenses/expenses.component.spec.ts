import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular/standalone';
import { AlertOptions } from '@ionic/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { PendingNotificationCandidate } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { GoogleWalletCaptureService } from '../../core/services/google-wallet-capture.service';
import { PendingNotificationQueueService } from '../../core/services/pending-notification-queue.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { ExpensesComponent } from './expenses.component';

describe('ExpensesComponent wallet notification flow', () => {
  let fixture: ComponentFixture<ExpensesComponent>;
  let alertOptions: AlertOptions | undefined;
  let engine: jasmine.SpyObj<FinancialEngineService>;
  let queue: {
    pendingCandidates: () => PendingNotificationCandidate[];
    pendingCount: () => number;
    loadError: () => string;
    markImported: jasmine.Spy;
    skip: jasmine.Spy;
    clearPending: jasmine.Spy;
  };
  let capture: jasmine.SpyObj<GoogleWalletCaptureService>;

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
    alertOptions = undefined;
    engine = jasmine.createSpyObj<FinancialEngineService>(
      'FinancialEngineService',
      ['getExpenses', 'addExpense', 'updateExpense']
    );
    engine.getExpenses.and.returnValue(of([]));
    queue = {
      pendingCandidates: () => [candidate],
      pendingCount: () => 1,
      loadError: () => '',
      markImported: jasmine.createSpy('markImported').and.resolveTo(undefined),
      skip: jasmine.createSpy('skip').and.resolveTo(undefined),
      clearPending: jasmine.createSpy('clearPending').and.resolveTo(undefined),
    };
    capture = jasmine.createSpyObj<GoogleWalletCaptureService>(
      'GoogleWalletCaptureService',
      ['refreshStatus', 'setEnabled', 'openAccessSettings', 'importPreviousNotifications', 'clearNativeQueue']
    );
    capture.refreshStatus.and.resolveTo();
    capture.importPreviousNotifications.and.resolveTo({
      permissionGranted: true,
      serviceConnected: true,
      accessibleCount: 1,
      addedCount: 1,
    });

    const alertController = {
      create: async (options: AlertOptions) => {
        alertOptions = options;
        return { present: async () => undefined } as Awaited<ReturnType<AlertController['create']>>;
      },
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
        { provide: AlertController, useValue: alertController },
        { provide: PendingNotificationQueueService, useValue: queue },
        { provide: GoogleWalletCaptureService, useValue: capture },
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
    expect(queue.skip).not.toHaveBeenCalled();
  });

  it('does not check notification history until the user confirms the alert', async () => {
    await fixture.componentInstance.confirmNotificationImport();

    expect(capture.importPreviousNotifications).not.toHaveBeenCalled();
    const cancelButton = alertOptions?.buttons?.find(
      button => typeof button !== 'string' && button.role === 'cancel'
    );
    expect(cancelButton && typeof cancelButton !== 'string' ? cancelButton.handler : undefined).toBeUndefined();

    const confirmButton = alertOptions?.buttons?.find(
      button => typeof button !== 'string' && button.text === 'Check History'
    );
    if (confirmButton && typeof confirmButton !== 'string') {
      await confirmButton.handler?.(undefined);
    }
    expect(capture.importPreviousNotifications).toHaveBeenCalledTimes(1);
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
