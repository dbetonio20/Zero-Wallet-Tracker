import { Injectable } from '@angular/core';
import { combineLatest, map, Observable } from 'rxjs';
import { FinancialEngineService } from './financial-engine.service';
import { CreditCardService } from './credit-card.service';
import { CategoryService } from './category.service';
import { SavingsGoalService } from './savings-goal.service';
import { PreferencesService } from './preferences.service';

/**
 * Builds a compact plain-text snapshot of ALL financial data
 * to use as the AI system prompt context.
 */
@Injectable({ providedIn: 'root' })
export class AiContextService {

  constructor(
    private engine: FinancialEngineService,
    private cards: CreditCardService,
    private categories: CategoryService,
    private goals: SavingsGoalService,
    private prefs: PreferencesService,
  ) {}

  /** Returns an observable that emits the latest system prompt string. */
  getContext$(): Observable<string> {
    return combineLatest([
      this.engine.getExpenses(),
      this.engine.getIncomes(),
      this.engine.getInstallments(),
      this.engine.getInstallmentPayments(),
      this.engine.getAllocations(),
      this.engine.summary$,
      this.cards.getCards(),
      this.categories.getCategories(),
      this.goals.getGoals(),
      this.prefs.getCurrencyCode$(),
    ]).pipe(
      map(([expenses, incomes, installments, payments, allocations, summary, cards, categories, goals, currency]) => {
        const today = new Date();
        const curYear = today.getFullYear();
        const curMonth = today.getMonth();
        const fmt = (n: number) => `${currency} ${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;

        const lines: string[] = [];
        lines.push(`You are a helpful financial assistant. Today: ${today.toISOString().split('T')[0]}. Currency: ${currency}.`);
        lines.push('Answer questions using ONLY the data below. Be concise and practical.');
        lines.push('When asked about a specific month, use the "Upcoming Payments by Month" section.');
        lines.push('');

        // ── Summary ──
        lines.push('## Financial Summary');
        lines.push(`Total Income: ${fmt(summary.totalIncome)}`);
        lines.push(`Total Unpaid Expenses: ${fmt(summary.totalExpenses)}`);
        lines.push(`Total Unpaid Installments: ${fmt(summary.totalInstallments)}`);
        lines.push(`Balance: ${fmt(summary.balance)}`);
        lines.push(`Overdue: ${fmt(summary.overdueAmount)}`);
        lines.push(`Upcoming 7 days: ${fmt(summary.upcomingAmount)}`);
        lines.push(`Allocated Income: ${fmt(summary.allocatedIncome)}`);
        lines.push(`Available Income: ${fmt(summary.availableIncome)}`);
        lines.push('');

        // ── Incomes ──
        lines.push(`## Incomes (${incomes.length})`);
        for (const i of incomes) {
          const used = allocations.filter(a => a.incomeId === i.id).reduce((s, a) => s + a.amount, 0);
          lines.push(`- ${i.source}: ${fmt(i.amount)}, date ${i.date}, used ${fmt(used)}, remaining ${fmt(i.amount - used)}${i.recurring ? ' (recurring)' : ''}`);
        }
        lines.push('');

        // ── Overdue Items ──
        const overdueExpenses = expenses.filter(e => e.status === 'overdue');
        const overduePayments = payments.filter(p => p.status === 'overdue');
        if (overdueExpenses.length || overduePayments.length) {
          lines.push('## Overdue Items');
          for (const e of overdueExpenses) {
            lines.push(`- EXPENSE: ${e.name || e.category} ${fmt(e.amount)}, was due ${e.date}`);
          }
          for (const p of overduePayments) {
            const inst = installments.find(i => i.id === p.installmentId);
            lines.push(`- INSTALLMENT: ${inst?.transaction ?? 'Unknown'} ${fmt(p.amount)}, was due ${p.dueDate}`);
          }
          lines.push('');
        }

        // ── Expenses this month ──
        const thisMonthExpenses = expenses.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === curYear && d.getMonth() === curMonth;
        });
        lines.push(`## Expenses This Month (${thisMonthExpenses.length})`);

        // Group by category
        const catMap = new Map<string, { total: number; items: string[]; budget?: number }>();
        for (const e of thisMonthExpenses) {
          if (!catMap.has(e.category)) {
            const cat = categories.find(c => c.name === e.category);
            catMap.set(e.category, { total: 0, items: [], budget: cat?.budget });
          }
          const group = catMap.get(e.category)!;
          group.total += e.amount;
          group.items.push(`${e.name || e.category} ${fmt(e.amount)} due ${e.date} [${e.status}]`);
        }
        for (const [cat, data] of catMap) {
          const budgetStr = data.budget ? ` (budget: ${fmt(data.budget)}, ${Math.round((data.total / data.budget) * 100)}% used)` : '';
          lines.push(`### ${cat}: ${fmt(data.total)}${budgetStr}`);
          for (const item of data.items) lines.push(`  - ${item}`);
        }
        lines.push('');

        // ── Upcoming Payments by Month (current + next 3 months) ──
        lines.push('## Upcoming Payments by Month');
        for (let m = 0; m <= 3; m++) {
          const targetDate = new Date(curYear, curMonth + m, 1);
          const targetYear = targetDate.getFullYear();
          const targetMonth = targetDate.getMonth();
          const monthLabel = `${targetDate.toLocaleString('en', { month: 'long' })} ${targetYear}`;

          const monthItems: string[] = [];

          // Unpaid expenses for this target month
          const targetExpenses = expenses.filter(e => {
            const d = new Date(e.date);
            return d.getFullYear() === targetYear && d.getMonth() === targetMonth && e.status !== 'paid';
          });
          for (const e of targetExpenses) {
            monthItems.push(`  - Expense: ${e.name || e.category} ${fmt(e.amount)}, due ${e.date} [${e.status}]`);
          }

          // Installment payments due this target month
          const targetInstPayments = payments.filter(p => {
            const d = new Date(p.dueDate);
            return d.getFullYear() === targetYear && d.getMonth() === targetMonth && p.status !== 'paid';
          });
          for (const p of targetInstPayments) {
            const inst = installments.find(i => i.id === p.installmentId);
            const card = inst ? cards.find(c => c.id === inst.cardId) : null;
            monthItems.push(`  - Installment: ${inst?.transaction ?? 'Unknown'} ${fmt(p.amount)}, due ${p.dueDate}${card ? ` (${card.bank} ${card.name})` : ''} [${p.status}]`);
          }

          // Recurring expense projections for future months
          if (m > 0) {
            const recurringExpenses = expenses.filter(e => e.recurring);
            const uniqueRecurring = new Map<string, typeof expenses[0]>();
            for (const e of recurringExpenses) {
              const key = `${e.name || ''}-${e.category}-${e.amount}`;
              if (!uniqueRecurring.has(key)) uniqueRecurring.set(key, e);
            }
            for (const [, e] of uniqueRecurring) {
              const alreadyExists = targetExpenses.some(me =>
                me.category === e.category && (me.name || '') === (e.name || '') && me.amount === e.amount
              );
              if (!alreadyExists) {
                monthItems.push(`  - Recurring: ${e.name || e.category} ${fmt(e.amount)} (projected)`);
              }
            }
          }

          if (monthItems.length) {
            const totalMonth = targetExpenses.reduce((s, e) => s + e.amount, 0)
              + targetInstPayments.reduce((s, p) => s + p.amount, 0);
            lines.push(`### ${monthLabel}: ~${fmt(totalMonth)} due`);
            for (const item of monthItems) lines.push(item);
          }
        }
        lines.push('');

        // ── Past months summary (last 3 months) ──
        lines.push('## Monthly Expense History');
        for (let m = 1; m <= 3; m++) {
          const d = new Date(curYear, curMonth - m, 1);
          const yr = d.getFullYear();
          const mo = d.getMonth();
          const monthExpenses = expenses.filter(e => {
            const ed = new Date(e.date);
            return ed.getFullYear() === yr && ed.getMonth() === mo;
          });
          const total = monthExpenses.reduce((s, e) => s + e.amount, 0);
          if (total > 0) {
            const monthLabel = `${d.toLocaleString('en', { month: 'short' })} ${yr}`;
            lines.push(`- ${monthLabel}: ${fmt(total)}`);
          }
        }
        lines.push('');

        // ── Installments Overview ──
        if (installments.length) {
          lines.push(`## Installments (${installments.length})`);
          for (const inst of installments) {
            const instPayments = payments.filter(p => p.installmentId === inst.id);
            const paid = instPayments.filter(p => p.status === 'paid').length;
            const unpaid = instPayments.filter(p => p.status !== 'paid');
            const nextDue = unpaid.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
            const card = cards.find(c => c.id === inst.cardId);
            lines.push(`- ${inst.transaction}: ${fmt(inst.monthlyAmount)}/mo, ${paid}/${inst.months} paid${nextDue ? `, next due ${nextDue.dueDate}` : ', fully paid'}${card ? `, card: ${card.bank} ${card.name}` : ''}`);
          }
          lines.push('');
        }

        // ── Credit Cards ──
        if (cards.length) {
          lines.push(`## Credit Cards (${cards.length})`);
          for (const c of cards) {
            const unpaid = payments
              .filter(p => {
                const inst = installments.find(i => i.id === p.installmentId);
                return inst?.cardId === c.id && p.status !== 'paid';
              })
              .reduce((s, p) => s + p.amount, 0);
            lines.push(`- ${c.bank} ${c.name}: limit ${fmt(c.creditLimit)}, outstanding ${fmt(unpaid)}, due day ${c.dueDate}, cutoff day ${c.cutoffDate}`);
          }
          lines.push('');
        }

        // ── Savings Goals ──
        if (goals.length) {
          lines.push(`## Savings Goals (${goals.length})`);
          for (const g of goals) {
            const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
            lines.push(`- ${g.name}: ${fmt(g.currentAmount)} / ${fmt(g.targetAmount)} (${pct}%)${g.deadline ? `, deadline ${g.deadline}` : ''}`);
          }
          lines.push('');
        }

        lines.push('Use ONLY this data. Be concise.');

        return lines.join('\n');
      }),
    );
  }
}
