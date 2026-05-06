import { Injectable, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  Expense,
  Income,
  Installment,
  InstallmentPayment,
  FinancialSummary,
  NewExpenseInput,
  NewIncomeInput,
  NewInstallmentInput,
  NewPaymentAllocationInput,
  PaymentAllocation,
  PaymentStatus,
  createSyncedEntity,
  filterActiveSyncedEntities,
  normalizeSyncedEntity,
  tombstoneSyncedEntity,
  touchSyncedEntity,
} from '../models';
import { StorageService } from './storage.service';
import { CreditCardService } from './credit-card.service';

const KEYS = {
  EXPENSES: 'expenses',
  INCOMES: 'incomes',
  INSTALLMENTS: 'installments',
  INSTALLMENT_PAYMENTS: 'installmentPayments',
  ALLOCATIONS: 'paymentAllocations',
};

@Injectable({ providedIn: 'root' })
export class FinancialEngineService {
  private readonly _expenses = signal<Expense[]>([]);
  private readonly _incomes = signal<Income[]>([]);
  private readonly _installments = signal<Installment[]>([]);
  private readonly _installmentPayments = signal<InstallmentPayment[]>([]);
  private readonly _allocations = signal<PaymentAllocation[]>([]);

  private readonly activeExpenses = computed(() => filterActiveSyncedEntities(this._expenses()));
  private readonly activeIncomes = computed(() => filterActiveSyncedEntities(this._incomes()));
  private readonly activeInstallments = computed(() => filterActiveSyncedEntities(this._installments()));
  private readonly activeInstallmentPayments = computed(() =>
    filterActiveSyncedEntities(this._installmentPayments())
  );
  private readonly activeAllocations = computed(() => filterActiveSyncedEntities(this._allocations()));

  /**
   * Computed financial summary — automatically recalculates whenever any
   * underlying signal changes. No manual combineLatest needed.
   */
  readonly summary = computed(() =>
    this.computeSummary(
      this.activeExpenses(),
      this.activeIncomes(),
      this.activeInstallments(),
      this.activeInstallmentPayments(),
      this.cardService.cards(),
      this.activeAllocations(),
    )
  );

  /** Observable alias for async-pipe consumers and AiContextService. */
  readonly summary$ = toObservable(this.summary);

  /** Observable accessors — backward compatible with all existing async-pipe consumers. */
  private readonly expenses$ = toObservable(this.activeExpenses);
  private readonly incomes$ = toObservable(this.activeIncomes);
  private readonly installments$ = toObservable(this.activeInstallments);
  private readonly installmentPayments$ = toObservable(this.activeInstallmentPayments);
  private readonly allocations$ = toObservable(this.activeAllocations);

  constructor(
    private storage: StorageService,
    private cardService: CreditCardService,
  ) {
    this.loadAll();
  }

  async loadAll(): Promise<void> {
    let [expenses, incomes, installments, payments, allocations, ccCards] = await Promise.all([
      this.storage.getList<Expense>(KEYS.EXPENSES),
      this.storage.getList<Income>(KEYS.INCOMES),
      this.storage.getList<Installment>(KEYS.INSTALLMENTS),
      this.storage.getList<InstallmentPayment>(KEYS.INSTALLMENT_PAYMENTS),
      this.storage.getList<PaymentAllocation>(KEYS.ALLOCATIONS),
      this.storage.getList<import('../models').CreditCard>('credit_cards'),
    ]);

    expenses = expenses.map(expense => normalizeSyncedEntity(expense));
    incomes = incomes.map(income => normalizeSyncedEntity(income));
    installments = installments.map(installment => normalizeSyncedEntity(installment));
    payments = payments.map(payment => normalizeSyncedEntity(payment));
    allocations = allocations.map(allocation => normalizeSyncedEntity(allocation));
    ccCards = ccCards.map(card => normalizeSyncedEntity(card));

    const activeExpenses = filterActiveSyncedEntities(expenses);
    const activeIncomes = filterActiveSyncedEntities(incomes);

    // Auto-generate current-month entries for recurring expenses
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();
    const generated: Expense[] = [];
    for (const e of activeExpenses) {
      if (!e.recurring) continue;
      const eDate = new Date(e.date);
      // Only seed from past months' recurring items
      if (eDate.getFullYear() === curYear && eDate.getMonth() === curMonth) continue;
      // Check if this month's copy already exists (same name + category + recurring)
      const exists = activeExpenses.some(x =>
        x.recurring &&
        x.name === e.name &&
        x.category === e.category &&
        (() => { const d = new Date(x.date); return d.getFullYear() === curYear && d.getMonth() === curMonth; })()
      );
      if (!exists) {
        const newDate = new Date(curYear, curMonth, Math.min(eDate.getDate(), new Date(curYear, curMonth + 1, 0).getDate()));
        const seeded: Expense = createSyncedEntity({
          ...e,
          id: this.uuid(),
          date: newDate.toISOString().split('T')[0],
          status: 'pending',
          paidAt: undefined,
        });
        generated.push(seeded);
      }
    }
    if (generated.length) {
      expenses = [...expenses, ...generated];
      await this.storage.saveList(KEYS.EXPENSES, expenses);
    }

    // Auto-generate current-month income for recurring incomes
    const generatedIncomes: Income[] = [];
    for (const i of activeIncomes) {
      if (!i.recurring) continue;
      const iDate = new Date(i.date);
      if (iDate.getFullYear() === curYear && iDate.getMonth() === curMonth) continue;
      const exists = activeIncomes.some(x =>
        x.recurring &&
        x.source === i.source &&
        (() => { const d = new Date(x.date); return d.getFullYear() === curYear && d.getMonth() === curMonth; })()
      );
      if (!exists) {
        const newDate = new Date(curYear, curMonth, Math.min(iDate.getDate(), new Date(curYear, curMonth + 1, 0).getDate()));
        generatedIncomes.push(createSyncedEntity({
          ...i,
          id: this.uuid(),
          date: newDate.toISOString().split('T')[0],
        }));
      }
    }
    if (generatedIncomes.length) {
      incomes = [...incomes, ...generatedIncomes];
      await this.storage.saveList(KEYS.INCOMES, incomes);
    }

    this.updateStatuses(
      filterActiveSyncedEntities(expenses),
      filterActiveSyncedEntities(payments),
      filterActiveSyncedEntities(ccCards)
    );
    this._expenses.set(expenses);
    this._incomes.set(incomes);
    this._installments.set(installments);
    this._installmentPayments.set(payments);
    this._allocations.set(allocations);
  }

  // ─── Expenses ────────────────────────────────────────────────────
  getExpenses() { return this.expenses$; }

  async addExpense(e: NewExpenseInput): Promise<void> {
    const item: Expense = createSyncedEntity({ ...e, id: this.uuid() });
    const updated = [...this._expenses(), item];
    await this.storage.saveList(KEYS.EXPENSES, updated);
    this._expenses.set(updated);
  }

  async updateExpense(e: Expense): Promise<void> {
    const updated = this._expenses().map(existingExpense =>
      existingExpense.id === e.id
        ? touchSyncedEntity({ ...existingExpense, ...e, createdAt: existingExpense.createdAt })
        : existingExpense
    );
    await this.storage.saveList(KEYS.EXPENSES, updated);
    this._expenses.set(updated);
  }

  async deleteExpense(id: string): Promise<void> {
    const updated = this._expenses().map(expense =>
      expense.id === id ? tombstoneSyncedEntity(expense) : expense
    );
    // Cascade-delete allocations linked to this expense
    const allocs = this._allocations().map(allocation =>
      allocation.expenseId === id ? tombstoneSyncedEntity(allocation) : allocation
    );
    await Promise.all([
      this.storage.saveList(KEYS.EXPENSES, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._expenses.set(updated);
    this._allocations.set(allocs);
  }

  // ─── Incomes ─────────────────────────────────────────────────────
  getIncomes() { return this.incomes$; }

  async addIncome(i: NewIncomeInput): Promise<void> {
    const item: Income = createSyncedEntity({ ...i, id: this.uuid() });
    const updated = [...this._incomes(), item];
    await this.storage.saveList(KEYS.INCOMES, updated);
    this._incomes.set(updated);
  }

  async updateIncome(i: Income): Promise<void> {
    const updated = this._incomes().map(existingIncome =>
      existingIncome.id === i.id
        ? touchSyncedEntity({ ...existingIncome, ...i, createdAt: existingIncome.createdAt })
        : existingIncome
    );
    await this.storage.saveList(KEYS.INCOMES, updated);
    this._incomes.set(updated);
  }

  async deleteIncome(id: string): Promise<void> {
    const updated = this._incomes().map(income =>
      income.id === id ? tombstoneSyncedEntity(income) : income
    );
    // Find allocations linked to this income
    const removedAllocs = this.activeAllocations().filter(allocation => allocation.incomeId === id);
    const remainingAllocs = this.activeAllocations().filter(allocation => allocation.incomeId !== id);
    const updatedAllocations = this._allocations().map(allocation =>
      allocation.incomeId === id ? tombstoneSyncedEntity(allocation) : allocation
    );

    // Revert expenses that were fully paid by this income (if no other allocations remain)
    const affectedExpenseIds = new Set(removedAllocs.filter(a => a.expenseId).map(a => a.expenseId!));
    const affectedPaymentIds = new Set(removedAllocs.filter(a => a.installmentPaymentId).map(a => a.installmentPaymentId!));

    // Check which expenses/payments still have other allocations
    const stillAllocatedExpenses = new Set(remainingAllocs.filter(a => a.expenseId).map(a => a.expenseId!));
    const stillAllocatedPayments = new Set(remainingAllocs.filter(a => a.installmentPaymentId).map(a => a.installmentPaymentId!));

    const expenses = this._expenses().map(e => {
      if (affectedExpenseIds.has(e.id) && !stillAllocatedExpenses.has(e.id) && e.status === 'paid') {
        return { ...e, status: 'pending' as PaymentStatus, paidAt: undefined };
      }
      return e;
    });

    const payments = this._installmentPayments().map(p => {
      if (affectedPaymentIds.has(p.id) && !stillAllocatedPayments.has(p.id) && p.status === 'paid') {
        return { ...p, status: 'pending' as PaymentStatus, paidAt: undefined };
      }
      return p;
    });

    await Promise.all([
      this.storage.saveList(KEYS.INCOMES, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, updatedAllocations),
      this.storage.saveList(KEYS.EXPENSES, expenses),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payments),
    ]);
    this._incomes.set(updated);
    this._allocations.set(updatedAllocations);
    this._expenses.set(expenses);
    this._installmentPayments.set(payments);
  }

  // ─── Installments ────────────────────────────────────────────────
  getInstallments() { return this.installments$; }
  getInstallmentPayments() { return this.installmentPayments$; }

  async addInstallment(inst: NewInstallmentInput): Promise<void> {
    const item: Installment = createSyncedEntity({ ...inst, id: this.uuid() });
    const instList = [...this._installments(), item];
    // Generate payment schedule
    const payments = this.generatePayments(item);
    const payList = [...this._installmentPayments(), ...payments];
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENTS, instList),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payList),
    ]);
    this._installments.set(instList);
    this._installmentPayments.set(payList);
  }

  async updateInstallment(inst: Installment): Promise<void> {
    const instList = this._installments().map(existingInstallment =>
      existingInstallment.id === inst.id
        ? touchSyncedEntity({ ...existingInstallment, ...inst, createdAt: existingInstallment.createdAt })
        : existingInstallment
    );
    const replacedPaymentIds = new Set(
      this.activeInstallmentPayments()
        .filter(payment => payment.installmentId === inst.id)
        .map(payment => payment.id)
    );
    // Tombstone old payments and regenerate a fresh schedule.
    const otherPayments = this._installmentPayments().map(payment =>
      payment.installmentId === inst.id ? tombstoneSyncedEntity(payment) : payment
    );
    const newPayments = this.generatePayments(inst);
    const payList = [...otherPayments, ...newPayments];
    const allocs = this._allocations().map(allocation =>
      allocation.installmentPaymentId && replacedPaymentIds.has(allocation.installmentPaymentId)
        ? tombstoneSyncedEntity(allocation)
        : allocation
    );
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENTS, instList),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payList),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._installments.set(instList);
    this._installmentPayments.set(payList);
    this._allocations.set(allocs);
  }

  async deleteInstallment(id: string): Promise<void> {
    const instList = this._installments().map(installment =>
      installment.id === id ? tombstoneSyncedEntity(installment) : installment
    );
    const removedPaymentIds = new Set(
      this.activeInstallmentPayments().filter(x => x.installmentId === id).map(x => x.id)
    );
    const payList = this._installmentPayments().map(payment =>
      payment.installmentId === id ? tombstoneSyncedEntity(payment) : payment
    );
    // Cascade-delete allocations linked to removed payments
    const allocs = this._allocations().map(allocation =>
      allocation.installmentPaymentId && removedPaymentIds.has(allocation.installmentPaymentId)
        ? tombstoneSyncedEntity(allocation)
        : allocation
    );
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENTS, instList),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payList),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._installments.set(instList);
    this._installmentPayments.set(payList);
    this._allocations.set(allocs);
  }

  async updateInstallmentPayment(payment: InstallmentPayment): Promise<void> {
    const updated = this._installmentPayments().map(existingPayment =>
      existingPayment.id === payment.id
        ? touchSyncedEntity({ ...existingPayment, ...payment, createdAt: existingPayment.createdAt })
        : existingPayment
    );
    await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated);
    this._installmentPayments.set(updated);
  }

  async deleteInstallmentPayment(id: string): Promise<void> {
    const updated = this._installmentPayments().map(payment =>
      payment.id === id ? tombstoneSyncedEntity(payment) : payment
    );
    // Cascade-delete allocations linked to this payment
    const allocs = this._allocations().map(allocation =>
      allocation.installmentPaymentId === id ? tombstoneSyncedEntity(allocation) : allocation
    );
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._installmentPayments.set(updated);
    this._allocations.set(allocs);
  }

  async markPayment(paymentId: string, status: PaymentStatus): Promise<void> {
    const paidAt = status === 'paid' ? new Date().toISOString().split('T')[0] : undefined;
    const updated = this._installmentPayments().map(payment =>
      payment.id === paymentId
        ? touchSyncedEntity({ ...payment, status, paidAt })
        : payment
    );
    await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated);
    this._installmentPayments.set(updated);
  }

  // ─── Payment Allocations ────────────────────────────────────────
  getAllocations() { return this.allocations$; }

  getAllocationsForIncome(incomeId: string): PaymentAllocation[] {
    return this.activeAllocations().filter(a => a.incomeId === incomeId);
  }

  getAllocationsForExpense(expenseId: string): PaymentAllocation[] {
    return this.activeAllocations().filter(a => a.expenseId === expenseId);
  }

  getAllocationsForInstallmentPayment(paymentId: string): PaymentAllocation[] {
    return this.activeAllocations().filter(a => a.installmentPaymentId === paymentId);
  }

  getIncomeUsed(incomeId: string): number {
    return this.activeAllocations()
      .filter(a => a.incomeId === incomeId)
      .reduce((s, a) => s + a.amount, 0);
  }

  getIncomeRemaining(incomeId: string): number {
    const income = this.activeIncomes().find(i => i.id === incomeId);
    if (!income) return 0;
    return income.amount - this.getIncomeUsed(incomeId);
  }

  async addAllocation(alloc: NewPaymentAllocationInput): Promise<void> {
    const item: PaymentAllocation = createSyncedEntity({ ...alloc, id: this.uuid() });
    const updated = [...this._allocations(), item];
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async addAllocations(allocs: NewPaymentAllocationInput[]): Promise<void> {
    const items = allocs.map(allocation => createSyncedEntity({ ...allocation, id: this.uuid() }));
    const updated = [...this._allocations(), ...items];
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async removeAllocation(id: string): Promise<void> {
    const alloc = this.activeAllocations().find(a => a.id === id);
    const updated = this._allocations().map(allocation =>
      allocation.id === id ? tombstoneSyncedEntity(allocation) : allocation
    );
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);

    // Check if expense/payment still has other allocations; if not, revert to pending
    if (alloc?.expenseId) {
      const remaining = filterActiveSyncedEntities(updated).filter(a => a.expenseId === alloc.expenseId);
      if (remaining.length === 0) {
        const expenses = this._expenses().map(e =>
          e.id === alloc.expenseId && e.status === 'paid'
            ? touchSyncedEntity({ ...e, status: 'pending' as PaymentStatus, paidAt: undefined })
            : e
        );
        await this.storage.saveList(KEYS.EXPENSES, expenses);
        this._expenses.set(expenses);
      }
    }
    if (alloc?.installmentPaymentId) {
      const remaining = filterActiveSyncedEntities(updated).filter(
        a => a.installmentPaymentId === alloc.installmentPaymentId
      );
      if (remaining.length === 0) {
        const payments = this._installmentPayments().map(p =>
          p.id === alloc.installmentPaymentId && p.status === 'paid'
            ? touchSyncedEntity({ ...p, status: 'pending' as PaymentStatus, paidAt: undefined })
            : p
        );
        await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payments);
        this._installmentPayments.set(payments);
      }
    }
  }

  async removeAllocationsForExpense(expenseId: string): Promise<void> {
    const updated = this._allocations().map(allocation =>
      allocation.expenseId === expenseId ? tombstoneSyncedEntity(allocation) : allocation
    );
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async removeAllocationsForPayment(paymentId: string): Promise<void> {
    const updated = this._allocations().map(allocation =>
      allocation.installmentPaymentId === paymentId ? tombstoneSyncedEntity(allocation) : allocation
    );
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  /** Pay an expense: create allocations + mark paid */
  async payExpenseWithIncomes(expense: Expense, allocations: { incomeId: string; amount: number }[]): Promise<void> {
    // Create allocations
    const allocItems = allocations.map(a => ({
      incomeId: a.incomeId,
      expenseId: expense.id,
      amount: a.amount,
    }));
    await this.addAllocations(allocItems);
    // Mark expense as paid
    await this.updateExpense({ ...expense, status: 'paid', paidAt: new Date().toISOString().split('T')[0] });
  }

  /** Pay an installment payment: create allocations + mark paid */
  async payInstallmentWithIncomes(payment: InstallmentPayment, allocations: { incomeId: string; amount: number }[]): Promise<void> {
    const allocItems = allocations.map(a => ({
      incomeId: a.incomeId,
      installmentPaymentId: payment.id,
      amount: a.amount,
    }));
    await this.addAllocations(allocItems);
    await this.markPayment(payment.id, 'paid');
  }

  // ─── Summary ─────────────────────────────────────────────────────
  private computeSummary(
    expenses: Expense[],
    incomes: Income[],
    installments: Installment[],
    payments: InstallmentPayment[],
    cards: import('../models').CreditCard[],
    allocations: PaymentAllocation[],
  ): FinancialSummary {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
    const totalExpenses = expenses
      .filter(e => e.status !== 'paid')
      .reduce((s, e) => s + e.amount, 0);
    const totalInstallments = payments
      .filter(p => p.status !== 'paid')
      .reduce((s, p) => s + p.amount, 0);
    const paidExpenses = expenses
      .filter(e => e.status === 'paid')
      .reduce((s, e) => s + e.amount, 0);
    const paidInstallments = payments
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + p.amount, 0);
    const totalObligations = totalExpenses + totalInstallments;

    // Credit card dues: sum of unpaid installment payments linked to credit cards
    const cardIds = new Set(cards.map(c => c.id));
    const cardLinkedInstIds = new Set(
      installments.filter(i => i.cardId && cardIds.has(i.cardId)).map(i => i.id)
    );
    const totalCreditDues = payments
      .filter(p => p.status !== 'paid' && cardLinkedInstIds.has(p.installmentId))
      .reduce((s, p) => s + p.amount, 0);

    const overdueExpenses = expenses
      .filter(e => e.status === 'overdue')
      .reduce((s, e) => s + e.amount, 0);
    const overduePayments = payments
      .filter(p => p.status === 'overdue')
      .reduce((s, p) => s + p.amount, 0);
    const overdueAmount = overdueExpenses + overduePayments;

    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    const upcomingExpenses = expenses
      .filter(e => {
        if (e.status !== 'pending') return false;
        if (e.paymentMethod === 'Credit Card' && e.creditCardId) {
          const card = cards.find(c => c.id === e.creditCardId);
          if (card) return this.cardService.getBillingCycleDueDate(e.date, card) <= in7Days;
        }
        return new Date(e.date) <= in7Days;
      })
      .reduce((s, e) => s + e.amount, 0);
    const upcomingPayments = payments
      .filter(p => p.status === 'pending' && new Date(p.dueDate) <= in7Days)
      .reduce((s, p) => s + p.amount, 0);
    const upcomingAmount = upcomingExpenses + upcomingPayments;

    const allocatedIncome = allocations.reduce((s, a) => s + a.amount, 0);
    const availableIncome = totalIncome - allocatedIncome;
    // Balance = income minus all outstanding (unpaid) obligations.
    // Adding an expense reduces balance immediately; marking it paid has no further effect on balance.
    // This is the conservative/protective model: balance answers "how much can I still commit to?"
    const balance = totalIncome - totalExpenses - totalInstallments;

    return {
      totalIncome,
      totalExpenses,
      totalInstallments,
      totalCreditDues,
      totalObligations,
      paidExpenses,
      paidInstallments,
      balance,
      overdueAmount,
      upcomingAmount,
      allocatedIncome,
      availableIncome,
    };
  }

  private generatePayments(inst: Installment): InstallmentPayment[] {
    const payments: InstallmentPayment[] = [];
    const start = new Date(inst.startDate);
    const isWeekly = inst.frequency === 'weekly';
    for (let i = 0; i < inst.months; i++) {
      const due = new Date(start);
      if (isWeekly) {
        due.setDate(due.getDate() + i * 7);
      } else {
        due.setMonth(due.getMonth() + i);
      }
      payments.push(createSyncedEntity({
        id: this.uuid(),
        installmentId: inst.id,
        dueDate: due.toISOString().split('T')[0],
        amount: inst.monthlyAmount,
        status: 'pending',
      }));
    }
    return payments;
  }

  private updateStatuses(
    expenses: Expense[],
    payments: InstallmentPayment[],
    cards: import('../models').CreditCard[] = [],
  ): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expenses.forEach(e => {
      if (e.status !== 'paid') {
        let compareDate: Date;
        if (e.paymentMethod === 'Credit Card' && e.creditCardId) {
          const card = cards.find(c => c.id === e.creditCardId);
          compareDate = card
            ? this.cardService.getBillingCycleDueDate(e.date, card)
            : new Date(e.date);
        } else {
          compareDate = new Date(e.date);
        }
        e.status = compareDate < today ? 'overdue' : 'pending';
      }
    });
    payments.forEach(p => {
      if (p.status !== 'paid') {
        const d = new Date(p.dueDate);
        p.status = d < today ? 'overdue' : 'pending';
      }
    });
  }

  private uuid(): string {
    return crypto.randomUUID();
  }
}
