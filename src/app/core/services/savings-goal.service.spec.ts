import { TestBed } from '@angular/core/testing';
import { SavingsGoal, WalletAccount } from '../models';
import { StorageService } from './storage.service';
import { SavingsGoalService } from './savings-goal.service';
import { WalletService } from './wallet.service';

describe('SavingsGoalService', () => {
  let service: SavingsGoalService;
  let persistedAccounts: SavingsGoal[];
  let walletBalance: number;
  const walletAccount: WalletAccount = {
    id: 'wallet',
    name: 'GCash',
    type: 'e-wallet',
    openingBalance: 100,
    currency: 'PHP',
    notes: '',
    isArchived: false,
    transactions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    serverUpdatedAt: null,
    deletedAt: null,
  };
  const storageMock: Pick<StorageService, 'getList' | 'saveList'> = {
    getList: async <T>(): Promise<T[]> => persistedAccounts as unknown as T[],
    saveList: async <T>(_key: string, list: T[]): Promise<void> => {
      persistedAccounts = list as SavingsGoal[];
    },
  };
  const walletMock: Pick<WalletService, 'getAccount' | 'getBalance'> = {
    getAccount: id => id === walletAccount.id ? walletAccount : undefined,
    getBalance: () => walletBalance,
  };

  beforeEach(async () => {
    persistedAccounts = [];
    walletBalance = 100;
    TestBed.configureTestingModule({
      providers: [
        SavingsGoalService,
        { provide: StorageService, useValue: storageMock },
        { provide: WalletService, useValue: walletMock },
      ],
    });
    service = TestBed.inject(SavingsGoalService);
    await service.reloadFromStorage();
  });

  it('preserves legacy goals and exposes them as goal accounts', () => {
    persistedAccounts.push({
      id: 'legacy-goal',
      name: 'Emergency fund',
      icon: 'flag-outline',
      color: '#4ade80',
      targetAmount: 100_000,
      currentAmount: 35_000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      serverUpdatedAt: null,
      deletedAt: null,
    });

    return service.reloadFromStorage().then(() => {
      expect(service.accounts()[0].type).toBe('goal');
      expect(service.accounts()[0].currentAmount).toBe(35_000);
      expect(service.accounts()[0].transactions).toEqual([]);
      expect(service.goals().length).toBe(1);
    });
  });

  it('records deposits and preserves balances above the goal target', async () => {
    persistedAccounts.push({
      id: 'goal',
      name: 'Emergency fund',
      icon: 'flag-outline',
      color: '#4ade80',
      targetAmount: 100,
      currentAmount: 90,
      type: 'goal',
      deadline: '2026-12-31',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      serverUpdatedAt: null,
      deletedAt: null,
    });
    await service.reloadFromStorage();

    await service.contribute('goal', 25, 'Payday');

    const account = service.accounts()[0];
    const transaction = account.transactions?.[0];
    expect(account.currentAmount).toBe(115);
    expect(transaction).toBeDefined();
    expect(transaction).toEqual(jasmine.objectContaining({
      accountId: 'goal',
      type: 'deposit',
      amount: 25,
      description: 'Payday',
    }));
    expect(Date.parse(transaction?.date ?? '')).not.toBeNaN();
  });

  it('rejects overdraws without changing the balance or history', async () => {
    await service.addAccount({ name: 'Travel', type: 'flexible', initialAmount: 30 });
    const accountId = service.accounts()[0].id;

    await expectAsync(service.withdraw(accountId, 31)).toBeRejectedWithError(
      'The withdrawal cannot exceed the available balance.'
    );
    expect(service.accounts()[0].currentAmount).toBe(30);
    expect(service.accounts()[0].transactions?.length).toBe(1);
  });

  it('serializes concurrent transactions so no balance updates are lost', async () => {
    await service.addAccount({ name: 'Travel', type: 'flexible', initialAmount: 30 });
    const accountId = service.accounts()[0].id;

    await Promise.all([
      service.contribute(accountId, 10),
      service.contribute(accountId, 20),
    ]);

    expect(service.accounts()[0].currentAmount).toBe(60);
    expect(service.accounts()[0].transactions?.length).toBe(3);
  });

  it('creates flexible and general accounts with persisted opening deposits', async () => {
    await service.addAccount({ name: 'Travel', type: 'flexible', initialAmount: 15 });
    await service.addAccount({ name: 'Reserve', type: 'general', initialAmount: 35 });

    expect(service.accounts().map(account => account.type)).toEqual(['flexible', 'general']);
    expect(service.accounts().map(account => account.currentAmount)).toEqual([15, 35]);
    expect(service.accounts().map(account => account.transactions?.[0].type)).toEqual([
      'deposit',
      'deposit',
    ]);
    expect(service.accounts().reduce((total, account) => total + account.currentAmount, 0)).toBe(50);
  });

  it('tracks savings as an allocation against wallet funds without moving the wallet balance', async () => {
    await service.addAccount({ name: 'Travel', type: 'flexible' });
    const savingsId = service.accounts()[0].id;

    await service.contribute(savingsId, 60, 'Trip fund', walletAccount.id);
    expect(service.accounts()[0].currentAmount).toBe(60);
    expect(service.accounts()[0].transactions?.[0].walletAccountId).toBe(walletAccount.id);
    expect(walletBalance).toBe(100);

    await expectAsync(service.contribute(savingsId, 50, 'More savings', walletAccount.id))
      .toBeRejectedWithError("The savings allocation cannot exceed the account's available balance.");
    await service.withdraw(savingsId, 20, 'Trip expense', walletAccount.id);
    await service.contribute(savingsId, 20, 'Unassigned funds');
    expect(service.accounts()[0].currentAmount).toBe(60);

    await expectAsync(service.withdraw(savingsId, 41, 'Too much', walletAccount.id))
      .toBeRejectedWithError('The withdrawal cannot exceed the savings reserved from this account.');
    await expectAsync(service.withdraw(savingsId, 21, 'Unassigned overdraw'))
      .toBeRejectedWithError('Choose the wallet account these savings were reserved from.');
  });
});
