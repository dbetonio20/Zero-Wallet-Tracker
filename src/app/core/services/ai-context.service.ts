import { Injectable } from '@angular/core';
import { combineLatest, map, Observable } from 'rxjs';
import { FinancialEngineService } from './financial-engine.service';
import { CreditCardService } from './credit-card.service';
import { CategoryService } from './category.service';
import { SavingsGoalService } from './savings-goal.service';
import { PreferencesService } from './preferences.service';

/**
 * Maximum total context size in characters.
 * ~3.2 chars/token → 3200 chars ≈ 1000 tokens, leaving ~3000 tokens
 * for chat history + model response within the 4096 KV cache.
 */
const MAX_CONTEXT_CHARS = 3200;

/**
 * Character budgets per section (priority order, highest first).
 * If a section is under budget, leftover cascades to later sections.
 * If over budget, each section auto-summarises within its own builder.
 */
const SECTION_BUDGETS = {
  header:       120,
  summary:      350,
  overdue:      400,
  thisMonth:    500,
  upcoming:     600,
  installments: 400,
  cards:        300,
  history:      200,
  goals:        200,
  incomes:      300,
} as const;

/**
 * Builds a compact, budget-constrained plain-text snapshot of financial data
 * for the on-device AI system prompt.
 *
 * Design principles:
 *  1. Each section builds independently within a char budget.
 *  2. Sections ordered by importance — overdue/current first.
 *  3. When data exceeds budget → auto-aggregate (counts + totals)
 *     instead of listing every item.
 *  4. Leftover budget cascades to later sections.
 *  5. Hard-capped at MAX_CONTEXT_CHARS — never crashes the model.
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

        // ── Section builders ─────────────────────────────────────────

        const buildHeader = (): string[] => [
          `Financial assistant. Date: ${today.toISOString().split('T')[0]}. Currency: ${currency}.`,
          'Use ONLY data below. Be concise.',
          '',
        ];

        const buildSummary = (): string[] => [
          '## Summary',
          `Income: ${fmt(summary.totalIncome)} | Expenses: ${fmt(summary.totalExpenses)} | Installments: ${fmt(summary.totalInstallments)}`,
          `Balance: ${fmt(summary.balance)} | Overdue: ${fmt(summary.overdueAmount)} | Next 7d: ${fmt(summary.upcomingAmount)}`,
          `Allocated: ${fmt(summary.allocatedIncome)} | Available: ${fmt(summary.availableIncome)}`,
          '',
        ];

        const buildOverdue = (budget: number): string[] => {
          const overdueExp = expenses.filter(e => e.status === 'overdue');
          const overduePay = payments.filter(p => p.status === 'overdue');
          if (!overdueExp.length && !overduePay.length) return [];

          const lines: string[] = ['## Overdue'];
          const items: string[] = [];
          for (const e of overdueExp)
            items.push(`${e.name || e.category} ${fmt(e.amount)} due ${e.date}`);
          for (const p of overduePay) {
            const inst = installments.find(i => i.id === p.installmentId);
            items.push(`${inst?.transaction ?? '?'} ${fmt(p.amount)} due ${p.dueDate}`);
          }
          return this.fitItems(lines, items, budget, 'overdue items');
        };

        const buildThisMonth = (budget: number): string[] => {
          const thisMonth = expenses.filter(e => {
            const d = new Date(e.date);
            return d.getFullYear() === curYear && d.getMonth() === curMonth;
          });
          if (!thisMonth.length) return ['## This Month: no expenses', ''];

          const catMap = new Map<string, { total: number; count: number; budget?: number }>();
          for (const e of thisMonth) {
            if (!catMap.has(e.category)) {
              const cat = categories.find(c => c.name === e.category);
              catMap.set(e.category, { total: 0, count: 0, budget: cat?.budget });
            }
            const g = catMap.get(e.category)!;
            g.total += e.amount;
            g.count++;
          }

          const total = thisMonth.reduce((s, e) => s + e.amount, 0);
          const lines: string[] = [`## This Month: ${fmt(total)} (${thisMonth.length} items)`];
          const items: string[] = [];
          for (const [cat, data] of catMap) {
            const bStr = data.budget ? ` ${Math.round((data.total / data.budget) * 100)}% of ${fmt(data.budget)}` : '';
            items.push(`${cat}: ${fmt(data.total)} (${data.count}x)${bStr}`);
          }
          return this.fitItems(lines, items, budget, 'categories');
        };

        const buildUpcoming = (budget: number): string[] => {
          const lines: string[] = ['## Upcoming'];
          const items: string[] = [];

          for (let m = 0; m <= 3; m++) {
            const tgt = new Date(curYear, curMonth + m, 1);
            const tgtY = tgt.getFullYear(), tgtM = tgt.getMonth();
            const label = `${tgt.toLocaleString('en', { month: 'short' })} ${tgtY}`;

            const mExp = expenses.filter(e => {
              const d = new Date(e.date);
              return d.getFullYear() === tgtY && d.getMonth() === tgtM && e.status !== 'paid';
            });
            const mPay = payments.filter(p => {
              const d = new Date(p.dueDate);
              return d.getFullYear() === tgtY && d.getMonth() === tgtM && p.status !== 'paid';
            });

            const expTotal = mExp.reduce((s, e) => s + e.amount, 0);
            const payTotal = mPay.reduce((s, p) => s + p.amount, 0);
            if (mExp.length || mPay.length) {
              items.push(`${label}: ~${fmt(expTotal + payTotal)} (${mExp.length} expenses, ${mPay.length} installments)`);
            }
          }
          if (!items.length) return [];
          return this.fitItems(lines, items, budget, 'months');
        };

        const buildInstallments = (budget: number): string[] => {
          if (!installments.length) return [];
          const lines: string[] = [`## Installments (${installments.length})`];
          const items: string[] = [];
          for (const inst of installments) {
            const instPay = payments.filter(p => p.installmentId === inst.id);
            const paid = instPay.filter(p => p.status === 'paid').length;
            const card = cards.find(c => c.id === inst.cardId);
            items.push(`${inst.transaction}: ${fmt(inst.monthlyAmount)}/mo, ${paid}/${inst.months} paid${card ? ` (${card.bank})` : ''}`);
          }
          return this.fitItems(lines, items, budget, 'installments');
        };

        const buildCards = (budget: number): string[] => {
          if (!cards.length) return [];
          const lines: string[] = [`## Cards (${cards.length})`];
          const items: string[] = [];
          for (const c of cards) {
            const outstanding = payments
              .filter(p => {
                const inst = installments.find(i => i.id === p.installmentId);
                return inst?.cardId === c.id && p.status !== 'paid';
              })
              .reduce((s, p) => s + p.amount, 0);
            items.push(`${c.bank} ${c.name}: limit ${fmt(c.creditLimit)}, owed ${fmt(outstanding)}, due day ${c.dueDate}`);
          }
          return this.fitItems(lines, items, budget, 'cards');
        };

        const buildHistory = (): string[] => {
          const lines: string[] = ['## History'];
          for (let m = 1; m <= 3; m++) {
            const d = new Date(curYear, curMonth - m, 1);
            const mExp = expenses.filter(e => {
              const ed = new Date(e.date);
              return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
            });
            const total = mExp.reduce((s, e) => s + e.amount, 0);
            if (total > 0) lines.push(`- ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}: ${fmt(total)}`);
          }
          lines.push('');
          return lines;
        };

        const buildGoals = (budget: number): string[] => {
          if (!goals.length) return [];
          const lines: string[] = [`## Goals (${goals.length})`];
          const items: string[] = [];
          for (const g of goals) {
            const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
            items.push(`${g.name}: ${fmt(g.currentAmount)}/${fmt(g.targetAmount)} (${pct}%)`);
          }
          return this.fitItems(lines, items, budget, 'goals');
        };

        const buildIncomes = (budget: number): string[] => {
          if (!incomes.length) return [];
          const lines: string[] = [`## Incomes (${incomes.length})`];
          const items: string[] = [];
          for (const i of incomes) {
            const used = allocations.filter(a => a.incomeId === i.id).reduce((s, a) => s + a.amount, 0);
            items.push(`${i.source}: ${fmt(i.amount)}, remaining ${fmt(i.amount - used)}${i.recurring ? ' (rec)' : ''}`);
          }
          return this.fitItems(lines, items, budget, 'incomes');
        };

        // ── Assemble with cascading budgets ──────────────────────────

        type SectionKey = keyof typeof SECTION_BUDGETS;
        const builders: [SectionKey, (budget: number) => string[]][] = [
          ['header',       () => buildHeader()],
          ['summary',      () => buildSummary()],
          ['overdue',      (b) => buildOverdue(b)],
          ['thisMonth',    (b) => buildThisMonth(b)],
          ['upcoming',     (b) => buildUpcoming(b)],
          ['installments', (b) => buildInstallments(b)],
          ['cards',        (b) => buildCards(b)],
          ['history',      () => buildHistory()],
          ['goals',        (b) => buildGoals(b)],
          ['incomes',      (b) => buildIncomes(b)],
        ];

        let remaining = MAX_CONTEXT_CHARS;
        const parts: string[] = [];

        for (const [key, builder] of builders) {
          const budget = Math.min(SECTION_BUDGETS[key], remaining);
          if (budget <= 0) break;

          const section = builder(budget).join('\n');
          const used = section.length;
          parts.push(section);
          remaining -= used;
        }

        return parts.join('\n').slice(0, MAX_CONTEXT_CHARS);
      }),
    );
  }

  /**
   * Fits items into a section within a character budget.
   * - If all items fit → list them all with "- " prefix.
   * - If not → show as many as fit + "...and N more".
   * - If even the header barely fits → one-line aggregate.
   */
  private fitItems(
    header: string[],
    items: string[],
    budget: number,
    noun: string,
  ): string[] {
    const headerText = header.join('\n');
    let available = budget - headerText.length - 10;

    if (available <= 0) {
      return [`${header[0]} (${items.length} ${noun})`, ''];
    }

    const result = [...header];
    let used = 0;

    for (let i = 0; i < items.length; i++) {
      const line = `- ${items[i]}`;
      if (used + line.length + 1 > available) {
        const remaining = items.length - i;
        result.push(`- ...and ${remaining} more ${noun}`);
        break;
      }
      result.push(line);
      used += line.length + 1;
    }

    result.push('');
    return result;
  }
}
