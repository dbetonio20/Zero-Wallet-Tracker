import { TestBed } from '@angular/core/testing';
import { Expense, SavingsGoal, WalletAccount } from '../models';
import { StorageService } from './storage.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let persistedAccounts: WalletAccount[];
  let persistedSavings: SavingsGoal[];
  let persistedExpenses: Expense[];
  let failNextSave: boolean;
  const expenseRecord = (id: string, accountId: string, amount: number): Expense => ({
    id,
    accountId,
    name: 'Lunch',
    category: 'Food',
    amount,
    date: '2026-10-20',
    paymentMethod: 'Cash',
    status: 'paid',
    paidAt: '2026-10-20',
    recurring: false,
    notes: '',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    serverUpdatedAt: null,
    deletedAt: null,
  });
  const storageMock: Pick<StorageService, 'getList' | 'saveList'> = {
    getList: async <T>(key: string): Promise<T[]> =>
      (key === 'savingsGoals'
        ? persistedSavings
        : key === 'expenses'
          ? persistedExpenses
          : key === 'incomes'
            ? []
            : persistedAccounts) as unknown as T[],
    saveList: async <T>(_key: string, list: T[]): Promise<void> => {
      if (failNextSave) {
        failNextSave = false;
        throw new Error('Storage unavailable.');
      }
      persistedAccounts = list as WalletAccount[];
    },
  };

  beforeEach(async () => {
    persistedAccounts = [];
    persistedSavings = [];
    persistedExpenses = [];
    failNextSave = false;
    TestBed.configureTestingModule({
      providers: [
        WalletService,
        { provide: StorageService, useValue: storageMock },
      ],
    });
    service = TestBed.inject(WalletService);
    await service.retryLoad();
  });

  it('creates an account with an opening balance and history', async () => {
    await service.addAccount({
      name: 'Cash',
      type: 'cash',
      openingBalance: 1_000,
      currency: 'PHP',
      notes: '',
      isArchived: false,
    });

    const account = service.accounts()[0];
    expect(service.getBalance(account)).toBe(1_000);
    expect(account.transactions[0]).toEqual(jasmine.objectContaining({
      type: 'opening',
      amount: 1_000,
      description: 'Opening balance',
    }));
  });

  it('reconciles a paid expense idempotently and adjusts amount, account, and deletion', async () => {
    await service.addAccount({
      name: 'Cash', type: 'cash', openingBalance: 1_000, currency: 'PHP', notes: '', isArchived: false,
    });
    await service.addAccount({
      name: 'GCash', type: 'e-wallet', openingBalance: 1_000, currency: 'PHP', notes: '', isArchived: false,
    });
    const [cash, gcash] = service.accounts();
    const expense = expenseRecord('meal', cash.id, 100);

    await service.reconcileFinancialRecords([expense], []);
    await service.reconcileFinancialRecords([expense], []);
    expect(service.getBalance(service.getAccount(cash.id)!)).toBe(900);

    const edited = { ...expense, amount: 250 };
    await service.reconcileFinancialRecords([edited], []);
    expect(service.getBalance(service.getAccount(cash.id)!)).toBe(750);

    const moved = { ...edited, accountId: gcash.id };
    await service.reconcileFinancialRecords([moved], []);
    expect(service.getBalance(service.getAccount(cash.id)!)).toBe(1_000);
    expect(service.getBalance(service.getAccount(gcash.id)!)).toBe(750);

    await service.reconcileFinancialRecords([{ ...moved, deletedAt: new Date().toISOString() }], []);
    expect(service.getBalance(service.getAccount(gcash.id)!)).toBe(1_000);
    expect(service.getAccount(gcash.id)?.transactions.some(transaction => transaction.voided)).toBeTrue();
  });

  it('credits linked income and reconciles edits and deletion', async () => {
    await service.addAccount({
      name: 'Bank', type: 'bank', openingBalance: 200, currency: 'PHP', notes: '', isArchived: false,
    });
    const accountId = service.accounts()[0].id;
    const income = {
      id: 'salary',
      accountId,
      amount: 500,
      date: '2026-10-01',
      name: 'October salary',
      source: 'Salary',
      recurring: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      serverUpdatedAt: null,
      deletedAt: null,
    };

    await service.reconcileFinancialRecords([], [income]);
    expect(service.getBalance(service.accounts()[0])).toBe(700);
    await service.reconcileFinancialRecords([], [{ ...income, amount: 700 }]);
    expect(service.getBalance(service.accounts()[0])).toBe(900);
    await service.reconcileFinancialRecords([], [{ ...income, deletedAt: new Date().toISOString() }]);
    expect(service.getBalance(service.accounts()[0])).toBe(200);
  });

  it('transfers once between accounts without creating financial transactions', async () => {
    await service.addAccount({
      name: 'From', type: 'bank', openingBalance: 1_000, currency: 'PHP', notes: '', isArchived: false,
    });
    await service.addAccount({
      name: 'To', type: 'e-wallet', openingBalance: 100, currency: 'PHP', notes: '', isArchived: false,
    });
    const [source, destination] = service.accounts();

    await service.transfer(source.id, destination.id, 250, '2026-10-22', 'Top up');

    expect(service.getBalance(service.getAccount(source.id)!)).toBe(750);
    expect(service.getBalance(service.getAccount(destination.id)!)).toBe(350);
    expect(service.accounts().flatMap(account => account.transactions).filter(tx => tx.transferId).length).toBe(2);
    await expectAsync(service.transfer(source.id, destination.id, 800, '2026-10-22')).toBeRejectedWithError(
      'The source account does not have enough unreserved funds.'
    );
    await expectAsync(service.transfer(source.id, source.id, 1, '2026-10-22')).toBeRejectedWithError(
      'Choose two different accounts.'
    );
  });

  it('records an external transfer on one account only, without a paired transfer or financial record', async () => {
    await service.addAccount({
      name: 'Bank', type: 'bank', openingBalance: 1_000, currency: 'PHP', notes: '', isArchived: false,
    });
    const account = service.accounts()[0];

    await service.recordExternalTransfer(account.id, 'out', 300, '2026-10-22', 'Sent to other bank');
    await service.recordExternalTransfer(account.id, 'in', 50, '2026-10-22');

    const updated = service.getAccount(account.id)!;
    expect(service.getBalance(updated)).toBe(750);
    expect(updated.transactions.filter(tx => tx.transferId).length).toBe(0);
    expect(updated.transactions.filter(tx => tx.type !== 'opening').every(tx => tx.sourceType === 'transfer')).toBeTrue();
    await expectAsync(service.recordExternalTransfer(account.id, 'out', 900, '2026-10-22')).toBeRejected();
  });

  it('keeps linked savings allocations available when validating expenses and transfers', async () => {
    await service.addAccount({
      name: 'Cash', type: 'cash', openingBalance: 100, currency: 'PHP', notes: '', isArchived: false,
    });
    await service.addAccount({
      name: 'Bank', type: 'bank', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false,
    });
    const [account, destination] = service.accounts();
    persistedSavings = [{
      id: 'travel',
      name: 'Travel',
      icon: 'wallet-outline',
      color: '#4ade80',
      targetAmount: 0,
      currentAmount: 80,
      transactions: [{
        id: 'reserve',
        accountId: 'travel',
        walletAccountId: account.id,
        type: 'deposit',
        amount: 80,
        date: '2026-10-22',
      }],
      createdAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
      serverUpdatedAt: null,
      deletedAt: null,
    }];

    await service.validateExpenseBalanceChange(undefined, expenseRecord('small', account.id, 20));
    await expectAsync(
      service.validateExpenseBalanceChange(undefined, expenseRecord('large', account.id, 21))
    ).toBeRejectedWithError('This change would reduce the account below savings funds reserved from it.');
    await expectAsync(service.transfer(account.id, destination.id, 21, '2026-10-22'))
      .toBeRejectedWithError('The source account does not have enough unreserved funds.');
    await expectAsync(service.archiveAccount(account.id))
      .toBeRejectedWithError('Release savings reserved from this account before archiving it.');
    expect(service.getAccount(account.id)?.isArchived).toBeFalse();
  });

  it('records balance adjustments without changing any income or expense records', async () => {
    await service.addAccount({
      name: 'Cash', type: 'cash', openingBalance: 100, currency: 'PHP', notes: '', isArchived: false,
    });
    const account = service.accounts()[0];

    await service.adjustBalance(account.id, 80, '2026-10-22', 'Cash count');

    expect(service.getBalance(service.accounts()[0])).toBe(80);
    expect(service.accounts()[0].transactions.at(-1)).toEqual(jasmine.objectContaining({
      type: 'adjustment',
      amount: -20,
      description: 'Cash count',
    }));
  });

  it('keeps the in-memory balance unchanged after storage failure and allows retry', async () => {
    await service.addAccount({
      name: 'From', type: 'bank', openingBalance: 500, currency: 'PHP', notes: '', isArchived: false,
    });
    await service.addAccount({
      name: 'To', type: 'cash', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false,
    });
    const [source, destination] = service.accounts();
    failNextSave = true;

    await expectAsync(service.transfer(source.id, destination.id, 100, '2026-10-22'))
      .toBeRejectedWithError('Storage unavailable.');
    expect(service.getBalance(service.getAccount(source.id)!)).toBe(500);
    expect(service.getBalance(service.getAccount(destination.id)!)).toBe(0);

    await service.transfer(source.id, destination.id, 100, '2026-10-22');
    expect(service.getBalance(service.getAccount(source.id)!)).toBe(400);
    expect(service.getBalance(service.getAccount(destination.id)!)).toBe(100);
  });


  it('deletes an account that has no activity beyond its opening balance', async () => {
    await service.addAccount({
      name: 'Old wallet', type: 'e-wallet', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false,
    });
    const account = service.accounts()[0];

    await service.deleteAccount(account.id);

    expect(service.getAccount(account.id)).toBeUndefined();
    expect(persistedAccounts[0].deletedAt).not.toBeNull();
  });

  it('refuses to delete an account with ledger activity or linked expenses', async () => {
    await service.addAccount({
      name: 'GCash', type: 'e-wallet', openingBalance: 500, currency: 'PHP', notes: '', isArchived: false,
    });
    const account = service.accounts()[0];
    await service.adjustBalance(account.id, 450, '2026-10-22', 'Count');
    await expectAsync(service.deleteAccount(account.id))
      .toBeRejectedWithError('This account has transactions or linked records, so it cannot be deleted. Archive it instead.');

    await service.addAccount({
      name: 'Bank', type: 'bank', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false,
    });
    const bank = service.accounts().find(item => item.name === 'Bank')!;
    persistedExpenses = [expenseRecord('expense-1', bank.id, 10)];
    await expectAsync(service.deleteAccount(bank.id))
      .toBeRejectedWithError('This account has transactions or linked records, so it cannot be deleted. Archive it instead.');
    expect(service.getAccount(bank.id)).toBeDefined();
  });

  it('restores an archived account', async () => {
    await service.addAccount({
      name: 'Cash', type: 'cash', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false,
    });
    const account = service.accounts()[0];
    await service.archiveAccount(account.id);
    expect(service.getAccount(account.id)?.isArchived).toBeTrue();

    await service.unarchiveAccount(account.id);

    expect(persistedAccounts[0].isArchived).toBeFalse();
    expect(service.getAccount(account.id)?.isArchived).toBeFalse();
  });

  it('links legacy expenses only to unambiguous active accounts', async () => {
    await service.addAccount({ name: 'GCash', type: 'e-wallet', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false });
    await service.addAccount({ name: 'Wallet', type: 'cash', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false });
    await service.addAccount({ name: 'Pocket', type: 'cash', openingBalance: 0, currency: 'PHP', notes: '', isArchived: false });
    await service.addAccount({ name: 'Old', type: 'bank', openingBalance: 0, currency: 'PHP', notes: '', isArchived: true });
    await service.archiveAccount(service.accounts().find(item => item.name === 'Old')!.id);
    const gcash = service.accounts().find(item => item.name === 'GCash')!;

    const legacy = (id: string, paymentMethod: string): Expense => ({
      ...expenseRecord(id, '', 10), accountId: undefined, paymentMethod,
    });
    const linked = await service.linkLegacyPaymentMethods([
      legacy('a', 'GCash'),
      legacy('b', 'Cash'),
      legacy('c', 'Credit Card'),
      legacy('d', 'Bank Transfer'),
    ]);

    expect(linked).not.toBeNull();
    expect(linked![0].accountId).toBe(gcash.id);
    expect(linked![1].accountId).toBeUndefined();
    expect(linked![2].accountId).toBeUndefined();
    expect(linked![3].accountId).toBeUndefined();
    expect(await service.linkLegacyPaymentMethods([legacy('e', 'Credit Card')])).toBeNull();
  });
});
