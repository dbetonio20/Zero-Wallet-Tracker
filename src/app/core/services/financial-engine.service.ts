import { Injectable, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Expense, Income, Installment, InstallmentPayment, FinancialSummary, PaymentStatus, PaymentAllocation } from '../models';
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

  /**
   * Computed financial summary — automatically recalculates whenever any
   * underlying signal changes. No manual combineLatest needed.
   */
  readonly summary = computed(() =>
    this.computeSummary(
      this._expenses(),
      this._incomes(),
      this._installments(),
      this._installmentPayments(),
      this.cardService.cards(),
      this._allocations(),
    )
  );

  /** Observable alias for async-pipe consumers and AiContextService. */
  readonly summary$ = toObservable(this.summary);

  /** Observable accessors — backward compatible with all existing async-pipe consumers. */
  private readonly expenses$ = toObservable(this._expenses);
  private readonly incomes$ = toObservable(this._incomes);
  private readonly installments$ = toObservable(this._installments);
  private readonly installmentPayments$ = toObservable(this._installmentPayments);
  private readonly allocations$ = toObservable(this._allocations);

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

    // Auto-generate current-month entries for recurring expenses
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();
    const generated: Expense[] = [];
    for (const e of expenses) {
      if (!e.recurring) continue;
      const eDate = new Date(e.date);
      // Only seed from past months' recurring items
      if (eDate.getFullYear() === curYear && eDate.getMonth() === curMonth) continue;
      // Check if this month's copy already exists (same name + category + recurring)
      const exists = expenses.some(x =>
        x.recurring &&
        x.name === e.name &&
        x.category === e.category &&
        (() => { const d = new Date(x.date); return d.getFullYear() === curYear && d.getMonth() === curMonth; })()
      );
      if (!exists) {
        const newDate = new Date(curYear, curMonth, Math.min(eDate.getDate(), new Date(curYear, curMonth + 1, 0).getDate()));
        const seeded: Expense = {
          ...e,
          id: this.uuid(),
          date: newDate.toISOString().split('T')[0],
          status: 'pending',
        };
        generated.push(seeded);
      }
    }
    if (generated.length) {
      expenses = [...expenses, ...generated];
      await this.storage.saveList(KEYS.EXPENSES, expenses);
    }

    // Auto-generate current-month income for recurring incomes
    const generatedIncomes: Income[] = [];
    for (const i of incomes) {
      if (!i.recurring) continue;
      const iDate = new Date(i.date);
      if (iDate.getFullYear() === curYear && iDate.getMonth() === curMonth) continue;
      const exists = incomes.some(x =>
        x.recurring &&
        x.source === i.source &&
        (() => { const d = new Date(x.date); return d.getFullYear() === curYear && d.getMonth() === curMonth; })()
      );
      if (!exists) {
        const newDate = new Date(curYear, curMonth, Math.min(iDate.getDate(), new Date(curYear, curMonth + 1, 0).getDate()));
        generatedIncomes.push({
          ...i,
          id: this.uuid(),
          date: newDate.toISOString().split('T')[0],
        });
      }
    }
    if (generatedIncomes.length) {
      incomes = [...incomes, ...generatedIncomes];
      await this.storage.saveList(KEYS.INCOMES, incomes);
    }

    this.updateStatuses(expenses, payments, ccCards);
    this._expenses.set(expenses);
    this._incomes.set(incomes);
    this._installments.set(installments);
    this._installmentPayments.set(payments);
    this._allocations.set(allocations);
  }

  // ─── Expenses ────────────────────────────────────────────────────
  getExpenses() { return this.expenses$; }

  async addExpense(e: Omit<Expense, 'id'>): Promise<void> {
    const item: Expense = { ...e, id: this.uuid() };
    const updated = [...this._expenses(), item];
    await this.storage.saveList(KEYS.EXPENSES, updated);
    this._expenses.set(updated);
  }

  async updateExpense(e: Expense): Promise<void> {
    const updated = this._expenses().map(x => x.id === e.id ? e : x);
    await this.storage.saveList(KEYS.EXPENSES, updated);
    this._expenses.set(updated);
  }

  async deleteExpense(id: string): Promise<void> {
    const updated = this._expenses().filter(x => x.id !== id);
    // Cascade-delete allocations linked to this expense
    const allocs = this._allocations().filter(a => a.expenseId !== id);
    await Promise.all([
      this.storage.saveList(KEYS.EXPENSES, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._expenses.set(updated);
    this._allocations.set(allocs);
  }

  // ─── Incomes ─────────────────────────────────────────────────────
  getIncomes() { return this.incomes$; }

  async addIncome(i: Omit<Income, 'id'>): Promise<void> {
    const item: Income = { ...i, id: this.uuid() };
    const updated = [...this._incomes(), item];
    await this.storage.saveList(KEYS.INCOMES, updated);
    this._incomes.set(updated);
  }

  async updateIncome(i: Income): Promise<void> {
    const updated = this._incomes().map(x => x.id === i.id ? i : x);
    await this.storage.saveList(KEYS.INCOMES, updated);
    this._incomes.set(updated);
  }

  async deleteIncome(id: string): Promise<void> {
    const updated = this._incomes().filter(x => x.id !== id);
    // Find allocations linked to this income
    const removedAllocs = this._allocations().filter(a => a.incomeId === id);
    const remainingAllocs = this._allocations().filter(a => a.incomeId !== id);

    // Revert expenses that were fully paid by this income (if no other allocations remain)
    const affectedExpenseIds = new Set(removedAllocs.filter(a => a.expenseId).map(a => a.expenseId!));
    const affectedPaymentIds = new Set(removedAllocs.filter(a => a.installmentPaymentId).map(a => a.installmentPaymentId!));

    // Check which expenses/payments still have other allocations
    const stillAllocatedExpenses = new Set(remainingAllocs.filter(a => a.expenseId).map(a => a.expenseId!));
    const stillAllocatedPayments = new Set(remainingAllocs.filter(a => a.installmentPaymentId).map(a => a.installmentPaymentId!));

    const expenses = this._expenses().map(e => {
      if (affectedExpenseIds.has(e.id) && !stillAllocatedExpenses.has(e.id) && e.status === 'paid') {
        return { ...e, status: 'pending' as PaymentStatus };
      }
      return e;
    });

    const payments = this._installmentPayments().map(p => {
      if (affectedPaymentIds.has(p.id) && !stillAllocatedPayments.has(p.id) && p.status === 'paid') {
        return { ...p, status: 'pending' as PaymentStatus };
      }
      return p;
    });

    await Promise.all([
      this.storage.saveList(KEYS.INCOMES, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, remainingAllocs),
      this.storage.saveList(KEYS.EXPENSES, expenses),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payments),
    ]);
    this._incomes.set(updated);
    this._allocations.set(remainingAllocs);
    this._expenses.set(expenses);
    this._installmentPayments.set(payments);
  }

  // ─── Installments ────────────────────────────────────────────────
  getInstallments() { return this.installments$; }
  getInstallmentPayments() { return this.installmentPayments$; }

  async addInstallment(inst: Omit<Installment, 'id'>): Promise<void> {
    const item: Installment = { ...inst, id: this.uuid() };
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
    const instList = this._installments().map(x => x.id === inst.id ? inst : x);
    // Remove old payments and regenerate
    const otherPayments = this._installmentPayments().filter(p => p.installmentId !== inst.id);
    const newPayments = this.generatePayments(inst);
    const payList = [...otherPayments, ...newPayments];
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENTS, instList),
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payList),
    ]);
    this._installments.set(instList);
    this._installmentPayments.set(payList);
  }

  async deleteInstallment(id: string): Promise<void> {
    const instList = this._installments().filter(x => x.id !== id);
    const removedPaymentIds = new Set(
      this._installmentPayments().filter(x => x.installmentId === id).map(x => x.id)
    );
    const payList = this._installmentPayments().filter(x => x.installmentId !== id);
    // Cascade-delete allocations linked to removed payments
    const allocs = this._allocations().filter(a => !a.installmentPaymentId || !removedPaymentIds.has(a.installmentPaymentId));
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
    const updated = this._installmentPayments().map(p =>
      p.id === payment.id ? payment : p
    );
    await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated);
    this._installmentPayments.set(updated);
  }

  async deleteInstallmentPayment(id: string): Promise<void> {
    const updated = this._installmentPayments().filter(p => p.id !== id);
    // Cascade-delete allocations linked to this payment
    const allocs = this._allocations().filter(a => a.installmentPaymentId !== id);
    await Promise.all([
      this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated),
      this.storage.saveList(KEYS.ALLOCATIONS, allocs),
    ]);
    this._installmentPayments.set(updated);
    this._allocations.set(allocs);
  }

  async markPayment(paymentId: string, status: PaymentStatus): Promise<void> {
    const updated = this._installmentPayments().map(p =>
      p.id === paymentId ? { ...p, status } : p
    );
    await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, updated);
    this._installmentPayments.set(updated);
  }

  // ─── Payment Allocations ────────────────────────────────────────
  getAllocations() { return this.allocations$; }

  getAllocationsForIncome(incomeId: string): PaymentAllocation[] {
    return this._allocations().filter(a => a.incomeId === incomeId);
  }

  getAllocationsForExpense(expenseId: string): PaymentAllocation[] {
    return this._allocations().filter(a => a.expenseId === expenseId);
  }

  getAllocationsForInstallmentPayment(paymentId: string): PaymentAllocation[] {
    return this._allocations().filter(a => a.installmentPaymentId === paymentId);
  }

  getIncomeUsed(incomeId: string): number {
    return this._allocations()
      .filter(a => a.incomeId === incomeId)
      .reduce((s, a) => s + a.amount, 0);
  }

  getIncomeRemaining(incomeId: string): number {
    const income = this._incomes().find(i => i.id === incomeId);
    if (!income) return 0;
    return income.amount - this.getIncomeUsed(incomeId);
  }

  async addAllocation(alloc: Omit<PaymentAllocation, 'id'>): Promise<void> {
    const item: PaymentAllocation = { ...alloc, id: this.uuid() };
    const updated = [...this._allocations(), item];
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async addAllocations(allocs: Omit<PaymentAllocation, 'id'>[]): Promise<void> {
    const items = allocs.map(a => ({ ...a, id: this.uuid() }));
    const updated = [...this._allocations(), ...items];
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async removeAllocation(id: string): Promise<void> {
    const alloc = this._allocations().find(a => a.id === id);
    const updated = this._allocations().filter(a => a.id !== id);
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);

    // Check if expense/payment still has other allocations; if not, revert to pending
    if (alloc?.expenseId) {
      const remaining = updated.filter(a => a.expenseId === alloc.expenseId);
      if (remaining.length === 0) {
        const expenses = this._expenses().map(e =>
          e.id === alloc.expenseId && e.status === 'paid' ? { ...e, status: 'pending' as PaymentStatus } : e
        );
        await this.storage.saveList(KEYS.EXPENSES, expenses);
        this._expenses.set(expenses);
      }
    }
    if (alloc?.installmentPaymentId) {
      const remaining = updated.filter(a => a.installmentPaymentId === alloc.installmentPaymentId);
      if (remaining.length === 0) {
        const payments = this._installmentPayments().map(p =>
          p.id === alloc.installmentPaymentId && p.status === 'paid' ? { ...p, status: 'pending' as PaymentStatus } : p
        );
        await this.storage.saveList(KEYS.INSTALLMENT_PAYMENTS, payments);
        this._installmentPayments.set(payments);
      }
    }
  }

  async removeAllocationsForExpense(expenseId: string): Promise<void> {
    const updated = this._allocations().filter(a => a.expenseId !== expenseId);
    await this.storage.saveList(KEYS.ALLOCATIONS, updated);
    this._allocations.set(updated);
  }

  async removeAllocationsForPayment(paymentId: string): Promise<void> {
    const updated = this._allocations().filter(a => a.installmentPaymentId !== paymentId);
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
    await this.updateExpense({ ...expense, status: 'paid' });
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
    for (let i = 0; i < inst.months; i++) {
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      payments.push({
        id: this.uuid(),
        installmentId: inst.id,
        dueDate: due.toISOString().split('T')[0],
        amount: inst.monthlyAmount,
        status: 'pending',
      });
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
