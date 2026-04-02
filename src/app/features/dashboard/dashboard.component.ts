import { Component, OnInit } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonBadge, IonList, IonItem, IonLabel,
  IonRefresher, IonRefresherContent, IonIcon,
  IonModal, IonButton, IonButtons, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonProgressBar,
  IonTextarea, IonFab, IonFabButton,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, createOutline, trashOutline, warningOutline,
  arrowDownOutline, arrowUpOutline, arrowBackOutline, alertCircleOutline,
  timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
  settingsOutline, chevronBackOutline, chevronForwardOutline, chevronDownOutline, checkmarkCircleOutline,
  trendingUpOutline, trendingDownOutline, saveOutline, bulbOutline,
  barbellOutline, leafOutline, ribbonOutline, flagOutline, removeOutline, addCircleOutline,
  receiptOutline, funnelOutline, calendarOutline,
} from 'ionicons/icons';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { NotificationService } from '../../core/services/notification.service';
import { CategoryService } from '../../core/services/category.service';
import { SavingsGoalService } from '../../core/services/savings-goal.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { FinancialSummary, Expense, InstallmentPayment, CreditCard, Income, PaymentAllocation, Installment, SavingsGoal } from '../../core/models';

const INCOME_SOURCES = ['Salary', 'Freelance', 'Business', 'Investment', 'Bonus', 'Other'];

interface IncomeVM extends Income {
  usedAmount: number;
  remainingAmount: number;
  usagePercent: number;
}

interface OverdueCardVM {
  card: CreditCard;
  dueDate: Date;
  unpaidAmount: number;
  lines: { transaction: string; amount: number; paymentId: string; dueDate: string }[];
}

interface UpcomingCardVM {
  card: CreditCard;
  dueDate: Date;
  pendingAmount: number;
  lines: { transaction: string; amount: number; paymentId: string; dueDate: string }[];
}

interface OverduePaymentVM extends InstallmentPayment {
  transaction: string;
}

interface BillingCycleGroup {
  label: string;       // e.g. 'Due Apr 20, 2026'
  dueDate: Date;
  expenses: (Expense & { billingDueDate: Date })[];
  total: number;
}

interface CardChargesVM {
  card: CreditCard;
  cycles: BillingCycleGroup[];
  expenses: (Expense & { billingDueDate: Date })[]; // flat list for Pay-All
  total: number;
}

interface InsightItem {
  icon: string;
  color: string;
  label: string;
  value: string;
  sub?: string;
}

interface SavingsGoalVM extends SavingsGoal {
  progressPercent: number;
  daysLeft?: number;
}

type MonthTransactionVM =
  | { kind: 'expense';      statusLabel: 'overdue' | 'upcoming' | 'paid'; sortDate: string; item: Expense }
  | { kind: 'payment';      statusLabel: 'overdue' | 'upcoming' | 'paid'; sortDate: string; item: OverduePaymentVM }
  | { kind: 'overdueCard';  statusLabel: 'overdue';                        sortDate: string; item: OverdueCardVM }
  | { kind: 'upcomingCard'; statusLabel: 'upcoming';                       sortDate: string; item: UpcomingCardVM };

interface DashboardVM {
  summary: FinancialSummary;
  incomes: IncomeVM[];
  monthlyIncome: number;
  unpaidTransactions: MonthTransactionVM[];
  paidTransactions: MonthTransactionVM[];
  monthlyTotal: number;
  overdueTotal: number;
  insights: InsightItem[];
  savingsGoals: SavingsGoalVM[];
  cardCharges: CardChargesVM[];
  recurringTotal: number;
  recurringExpenses: Expense[];
  pendingExpenses: Expense[];
}

type PayTarget =
  | { kind: 'expense'; item: Expense }
  | { kind: 'installment'; paymentId: string; transaction: string; amount: number }
  | { kind: 'card'; lines: { paymentId: string; transaction: string; amount: number }[]; cardExpenses: Expense[]; cardName: string; totalAmount: number };

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonBadge, IonList, IonItem, IonLabel,
    IonRefresher, IonRefresherContent, IonIcon,
    IonModal, IonButton, IonButtons, IonInput, IonSelect, IonSelectOption,
    IonToggle,
    IonProgressBar, IonTextarea, IonFab, IonFabButton,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  vm$!: Observable<DashboardVM>;
  isIncomeModalOpen = false;
  incomeSources = INCOME_SOURCES;
  editingIncome: Income | null = null;
  incomeForm: Partial<Income> = this.blankIncome();
  userName = 'User';
  userInitial = 'U';
  currencyCode = 'PHP';
  expandedCardIds = new Set<string>();
  payingIds = new Set<string>();
  isRecurringListOpen = false;
  payWithIncomeTarget: PayTarget | null = null;
  isPayWithIncomeOpen = false;
  selectedIncomeId: string | null = null;
  payWithIncomeInProgress = false;
  latestIncomes: IncomeVM[] = [];

  // ─── Savings Goals UI ────────────────────────────────────────────────
  isGoalModalOpen = false;
  editingGoal: SavingsGoal | null = null;
  goalForm: Partial<SavingsGoal> = this.blankGoal();
  isContributeModalOpen = false;
  contributeGoal: SavingsGoalVM | null = null;
  contributeAmount = 0;
  contributeMode: 'add' | 'withdraw' = 'add';

  readonly goalIcons = [
    'flag-outline', 'ribbon-outline', 'leaf-outline', 'barbell-outline',
    'save-outline', 'home-outline', 'car-outline', 'bulb-outline',
    'cart-outline', 'airplane-outline', 'school-outline', 'heart-outline',
  ];
  readonly goalColors = [
    '#4ade80', '#facc15', '#f97316', '#ec4899',
    '#3b82f6', '#14b8a6', '#c084fc', '#f87171',
  ];

  // ─── Salary Allocation Planner ───────────────────────────────────────
  isAllocPlannerOpen = false;
  allocPlannerIncome: IncomeVM | null = null;
  allocPlannerExpenses: Array<Expense & { selected: boolean }> = [];
  allocPlannerInProgress = false;

  get allocPlannerSelectedTotal(): number {
    return this.allocPlannerExpenses.filter(e => e.selected).reduce((s, e) => s + e.amount, 0);
  }

  openAllocPlanner(income: IncomeVM): void {
    this.allocPlannerIncome = income;
    const pendingExpenses = this.engine.getExpenses();
    let snapshot: Expense[] = [];
    pendingExpenses.subscribe(list => snapshot = list).unsubscribe();
    this.allocPlannerExpenses = snapshot
      .filter(e => e.status !== 'paid')
      .map(e => ({ ...e, selected: false }));
    this.isAllocPlannerOpen = true;
  }

  closeAllocPlanner(): void {
    this.isAllocPlannerOpen = false;
    this.allocPlannerIncome = null;
    this.allocPlannerExpenses = [];
  }

  async confirmAllocPlan(): Promise<void> {
    if (!this.allocPlannerIncome || this.allocPlannerInProgress) return;
    const selected = this.allocPlannerExpenses.filter(e => e.selected);
    if (!selected.length) return;
    this.allocPlannerInProgress = true;
    try {
      for (const e of selected) {
        await this.engine.payExpenseWithIncomes(e, [{ incomeId: this.allocPlannerIncome.id, amount: e.amount }]);
      }
      this.notifs.scheduleAll().catch(() => {});
    } finally {
      this.allocPlannerInProgress = false;
      this.closeAllocPlanner();
    }
  }

  toggleAllocExpense(id: string): void {
    const e = this.allocPlannerExpenses.find(x => x.id === id);
    if (e) e.selected = !e.selected;
  }

  toggleCardExpand(cardId: string): void {
    if (this.expandedCardIds.has(cardId)) {
      this.expandedCardIds.delete(cardId);
    } else {
      this.expandedCardIds.add(cardId);
    }
  }

  openRecurringModal(): void {
    this.isRecurringListOpen = true;
  }

  closeRecurringModal(): void {
    this.isRecurringListOpen = false;
  }

  markExpensePaid(expense: Expense, event: Event): void {
    event.stopPropagation();
    this.openPayWithIncome({ kind: 'expense', item: expense });
  }

  markInstallmentPaid(paymentId: string, transaction: string, amount: number, _dueDate: string, event: Event): void {
    event.stopPropagation();
    this.openPayWithIncome({ kind: 'installment', paymentId, transaction, amount });
  }

  markAllCardPaid(
    lines: { paymentId: string; transaction: string; amount: number }[],
    cardName: string,
    totalAmount: number,
    event: Event,
    cardExpenses: Expense[] = [],
  ): void {
    event.stopPropagation();
    const expensesTotal = cardExpenses.reduce((s, e) => s + e.amount, 0);
    this.openPayWithIncome({ kind: 'card', lines, cardExpenses, cardName, totalAmount: totalAmount + expensesTotal });
  }

  openPayWithIncome(target: PayTarget): void {
    this.payWithIncomeTarget = target;
    this.selectedIncomeId = null;
    this.isPayWithIncomeOpen = true;
  }

  closePayWithIncomeModal(): void {
    this.isPayWithIncomeOpen = false;
    this.payWithIncomeTarget = null;
    this.selectedIncomeId = null;
  }

  get payTargetLabel(): string {
    if (!this.payWithIncomeTarget) return '';
    const t = this.payWithIncomeTarget;
    if (t.kind === 'expense') return t.item.name || t.item.category;
    if (t.kind === 'installment') return t.transaction;
    return t.cardName;
  }

  get payTargetAmount(): number {
    if (!this.payWithIncomeTarget) return 0;
    const t = this.payWithIncomeTarget;
    if (t.kind === 'expense') return t.item.amount;
    if (t.kind === 'installment') return t.amount;
    return t.totalAmount; // already includes cardExpenses total
  }

  async confirmPayWithIncome(): Promise<void> {
    if (!this.payWithIncomeTarget || !this.selectedIncomeId || this.payWithIncomeInProgress) return;
    this.payWithIncomeInProgress = true;
    const t = this.payWithIncomeTarget;
    const incomeId = this.selectedIncomeId;
    try {
      if (t.kind === 'expense') {
        await this.engine.payExpenseWithIncomes(t.item, [{ incomeId, amount: t.item.amount }]);
      } else if (t.kind === 'installment') {
        await this.engine.addAllocations([{ incomeId, installmentPaymentId: t.paymentId, amount: t.amount }]);
        await this.engine.markPayment(t.paymentId, 'paid');
      } else {
        // Pay installment lines
        if (t.lines.length) {
          const allocs = t.lines.map(l => ({ incomeId, installmentPaymentId: l.paymentId, amount: l.amount }));
          await this.engine.addAllocations(allocs);
          for (const line of t.lines) {
            await this.engine.markPayment(line.paymentId, 'paid');
          }
        }
        // Also mark CC-charged expenses as paid
        for (const e of t.cardExpenses) {
          await this.engine.payExpenseWithIncomes(e, [{ incomeId, amount: e.amount }]);
        }
      }
      this.notifs.scheduleAll().catch(() => {});
    } finally {
      this.payWithIncomeInProgress = false;
      this.closePayWithIncomeModal();
    }
  }

  constructor(
    private engine: FinancialEngineService,
    private cardService: CreditCardService,
    private prefs: PreferencesService,
    private router: Router,
    private notifs: NotificationService,
    private categoryService: CategoryService,
    private goalService: SavingsGoalService,
    private quickAdd: QuickAddService,
  ) {
    addIcons({
      addOutline, createOutline, trashOutline, warningOutline,
      arrowDownOutline, arrowUpOutline, arrowBackOutline, alertCircleOutline,
      timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
      settingsOutline, chevronBackOutline, chevronForwardOutline, chevronDownOutline, checkmarkCircleOutline,
      trendingUpOutline, trendingDownOutline, saveOutline, bulbOutline,
      barbellOutline, leafOutline, ribbonOutline, flagOutline, removeOutline, addCircleOutline,
      receiptOutline, funnelOutline, calendarOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.userInitial = this.prefs.getUserInitial(this.userName);
    this.currencyCode = this.prefs.currentCurrencyCode;
    this.buildVM();
  }

  goToSettings(): void {
    this.router.navigate(['/settings']);
  }

  quickLogExpense(): void {
    this.quickAdd.trigger();
    this.router.navigate(['/expenses']);
  }

  private buildVM(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);

    this.vm$ = combineLatest([
      this.engine.summary$,
      this.engine.getIncomes(),
      this.engine.getExpenses(),
      this.engine.getInstallmentPayments(),
      this.cardService.getCards(),
      this.engine.getAllocations(),
      this.engine.getInstallments(),
      this.goalService.getGoals(),
      this._viewYear$,
      this._viewMonth$,
      this._txSortBy$,
    ]).pipe(
      map(([summary, incomes, expenses, payments, cards, allocations, installments, goals, selYear, selMonth, sortBy]) => {
        // Total of all expenses + installment payments due in the current calendar month (any status)
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        // Filter incomes to current month only for display & totals
        const monthIncomes = incomes.filter(i => {
          const d = new Date(i.date);
          return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
        });

        const incomeVMs: IncomeVM[] = monthIncomes.map(income => {
          const used = allocations
            .filter(a => a.incomeId === income.id)
            .reduce((s, a) => s + a.amount, 0);
          return {
            ...income,
            usedAmount: used,
            remainingAmount: income.amount - used,
            usagePercent: income.amount > 0 ? Math.min(100, (used / income.amount) * 100) : 0,
          };
        });

        const monthlyIncome = monthIncomes.reduce((s, i) => s + i.amount, 0);

        // Credit cards that are overdue: due day has passed this month AND have unpaid linked installments
        const overdueCards: OverdueCardVM[] = cards
          .filter(c => {
            const due = new Date(currentYear, currentMonth, c.dueDate);
            return due < today;
          })
          .map(c => {
            const cardInstallments = installments.filter((inst: Installment) => inst.cardId === c.id);
            const unpaidPayments = payments.filter(p => {
              const pd = new Date(p.dueDate);
              return cardInstallments.some((inst: Installment) => inst.id === p.installmentId) &&
                p.status !== 'paid' &&
                pd.getFullYear() === currentYear &&
                pd.getMonth() === currentMonth;
            });
            const unpaidAmount = unpaidPayments.reduce((s, p) => s + p.amount, 0);
            const lines = unpaidPayments.map(p => {
              const inst = cardInstallments.find((i: Installment) => i.id === p.installmentId);
              return { transaction: inst?.transaction ?? 'Installment', amount: p.amount, paymentId: p.id, dueDate: p.dueDate };
            });
            const dueDate = new Date(currentYear, currentMonth, c.dueDate);
            return { card: c, dueDate, unpaidAmount, lines };
          })
          .filter(occ => occ.unpaidAmount > 0);

        // True overdue total: overdue expenses + overdue standalone payments + all unpaid card-linked amounts
        const overdueTotal =
          expenses.filter(e => e.status === 'overdue').reduce((s, e) => s + e.amount, 0) +
          payments.filter(p => {
            if (p.status !== 'overdue') return false;
            const inst = installments.find((i: Installment) => i.id === p.installmentId);
            return !inst?.cardId;
          }).reduce((s, p) => s + p.amount, 0) +
          overdueCards.reduce((s, occ) => s + occ.unpaidAmount, 0);

        const monthlyTotal =
          expenses
            .filter(e => { const d = new Date(e.date); return d.getFullYear() === selYear && d.getMonth() === selMonth; })
            .reduce((s, e) => s + e.amount, 0) +
          payments
            .filter(p => { const d = new Date(p.dueDate); return d.getFullYear() === selYear && d.getMonth() === selMonth; })
            .reduce((s, p) => s + p.amount, 0);

        // Card-linked installment IDs — separates card-grouped vs standalone payments
        const cardLinkedInstallmentIds = new Set(
          installments.filter((i: Installment) => i.cardId).map((i: Installment) => i.id)
        );

        // Group ALL card-linked payments due in the selected month by card (no 7-day cap).
        const selMonthCardPaymentMap = new Map<string, { card: CreditCard; cardPayments: InstallmentPayment[] }>();
        for (const p of payments) {
          if (!cardLinkedInstallmentIds.has(p.installmentId)) continue;
          const pd = new Date(p.dueDate);
          if (pd.getFullYear() !== selYear || pd.getMonth() !== selMonth) continue;
          const inst = installments.find((i: Installment) => i.id === p.installmentId);
          if (!inst?.cardId) continue;
          const card = cards.find(c => c.id === inst.cardId);
          if (!card) continue;
          if (!selMonthCardPaymentMap.has(card.id)) selMonthCardPaymentMap.set(card.id, { card, cardPayments: [] });
          selMonthCardPaymentMap.get(card.id)!.cardPayments.push(p);
        }

        // ─── Credit Card Charges ─────────────────────────────────────
        const cardCharges: CardChargesVM[] = cards
          .map(card => {
            // Filter CC expenses whose billing-cycle due date falls in the selected month
            const linked = expenses.filter(e => {
              if (e.creditCardId !== card.id || e.status === 'paid') return false;
              const due = this.cardService.getBillingCycleDueDate(e.date, card);
              return due.getFullYear() === selYear && due.getMonth() === selMonth;
            });
            const annotated = linked.map(e => ({
              ...e,
              billingDueDate: this.cardService.getBillingCycleDueDate(e.date, card),
            }));
            // Group by billing-cycle due date
            const cycleMap = new Map<string, (Expense & { billingDueDate: Date })[]>();
            for (const e of annotated) {
              const key = e.billingDueDate.toISOString().split('T')[0];
              if (!cycleMap.has(key)) cycleMap.set(key, []);
              cycleMap.get(key)!.push(e);
            }
            const cycles: BillingCycleGroup[] = Array.from(cycleMap.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, exps]) => ({
                label: `Due ${exps[0].billingDueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                dueDate: exps[0].billingDueDate,
                expenses: exps,
                total: exps.reduce((s, e) => s + e.amount, 0),
              }));
            const total = annotated.reduce((s, e) => s + e.amount, 0);
            return { card, cycles, expenses: annotated, total };
          })
          .filter(cc => cc.cycles.length > 0);

        // ─── Savings Goals VM ──────────────────────────────────────────
        const savingsGoals: SavingsGoalVM[] = goals.map(g => {
          const progressPercent = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
          let daysLeft: number | undefined;
          if (g.deadline) {
            const diff = new Date(g.deadline).getTime() - today.getTime();
            daysLeft = Math.max(0, Math.ceil(diff / 86400000));
          }
          return { ...g, progressPercent, daysLeft };
        });

        // ─── Spending Insights ─────────────────────────────────────────
        const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
        const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
        const curMonth = today.getMonth();
        const curYear = today.getFullYear();

        const expensesThisMonth = expenses.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === curYear && d.getMonth() === curMonth;
        });
        const expensesLastMonth = expenses.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
        });
        const totalThisMonth = expensesThisMonth.reduce((s, e) => s + e.amount, 0);
        const totalLastMonth = expensesLastMonth.reduce((s, e) => s + e.amount, 0);
        const spendDelta = totalThisMonth - totalLastMonth;

        // Top spending category this month
        const catTotals = new Map<string, number>();
        for (const e of expensesThisMonth) {
          catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amount);
        }
        let topCat = '';
        let topCatAmount = 0;
        catTotals.forEach((amt, cat) => { if (amt > topCatAmount) { topCatAmount = amt; topCat = cat; } });

        // Biggest single expense this month
        const biggestExpense = expensesThisMonth.reduce<Expense | null>((max, e) => !max || e.amount > max.amount ? e : max, null);

        // Savings rate: (monthlyIncome - totalThisMonth) / monthlyIncome
        const savingsRate = monthlyIncome > 0
          ? Math.max(0, (monthlyIncome - totalThisMonth) / monthlyIncome)
          : 0;

        const insights: InsightItem[] = [];
        if (totalLastMonth > 0) {
          insights.push({
            icon: spendDelta > 0 ? 'trending-up-outline' : 'trending-down-outline',
            color: spendDelta > 0 ? '#f87171' : '#4ade80',
            label: spendDelta > 0 ? 'More than last month' : 'Less than last month',
            value: `${spendDelta > 0 ? '+' : ''}${this.formatCurrency(Math.abs(spendDelta))}`,
            sub: `vs ${this.formatCurrency(totalLastMonth)} last month`,
          });
        }
        if (topCat) {
          insights.push({
            icon: 'bulb-outline',
            color: '#facc15',
            label: 'Top category this month',
            value: topCat,
            sub: this.formatCurrency(topCatAmount),
          });
        }
        if (biggestExpense) {
          insights.push({
            icon: 'flag-outline',
            color: '#c084fc',
            label: 'Biggest expense',
            value: biggestExpense.name || biggestExpense.category,
            sub: this.formatCurrency(biggestExpense.amount),
          });
        }
        if (monthlyIncome > 0) {
          insights.push({
            icon: 'leaf-outline',
            color: savingsRate >= 0.2 ? '#4ade80' : '#f97316',
            label: 'Savings rate',
            value: `${Math.round(savingsRate * 100)}%`,
            sub: savingsRate >= 0.2 ? 'Great job!' : 'Aim for 20%+',
          });
        }

        // ─── Unified Monthly Transactions ─────────────────────────────────────
        const statusOrder: Record<string, number> = { overdue: 0, upcoming: 1, paid: 2 };

        const monthlyExpenseItems: MonthTransactionVM[] = expenses
          .filter(e => {
            const d = new Date(e.date);
            // Exclude unpaid CC-linked expenses (shown grouped in card blocks).
            // Paid CC-linked expenses are included here so they appear in the paid list.
            return d.getFullYear() === selYear && d.getMonth() === selMonth &&
              (!e.creditCardId || e.status === 'paid');
          })
          .map(e => ({
            kind: 'expense' as const,
            statusLabel: (e.status === 'pending' ? 'upcoming' : e.status) as 'overdue' | 'upcoming' | 'paid',
            sortDate: e.date,
            item: e,
          }));

        const monthlyPaymentItems: MonthTransactionVM[] = payments
          .filter(p => {
            const d = new Date(p.dueDate);
            // Exclude unpaid card-linked payments (shown grouped in card blocks).
            // Paid card-linked payments are included here so they appear in the paid list.
            return d.getFullYear() === selYear && d.getMonth() === selMonth &&
              (!cardLinkedInstallmentIds.has(p.installmentId) || p.status === 'paid');
          })
          .map(p => {
            const inst = installments.find((i: Installment) => i.id === p.installmentId);
            const pm: OverduePaymentVM = { ...p, transaction: inst?.transaction ?? 'Installment Payment' };
            return {
              kind: 'payment' as const,
              statusLabel: (p.status === 'pending' ? 'upcoming' : p.status) as 'overdue' | 'upcoming' | 'paid',
              sortDate: p.dueDate,
              item: pm,
            };
          });

        const overdueCardItems: MonthTransactionVM[] = overdueCards.map(occ => ({
          kind: 'overdueCard' as const,
          statusLabel: 'overdue' as const,
          sortDate: occ.dueDate.toISOString(),
          item: occ,
        }));

        // Build card-group transaction items for the selected month (all unpaid card-linked payments,
        // regardless of 7-day window — classifies by whether the card due date has passed in selYear/selMonth).
        const selMonthCardItems: MonthTransactionVM[] = [];
        for (const { card: c, cardPayments } of selMonthCardPaymentMap.values()) {
          // Skip cards already covered by overdueCardItems (current month, due date past)
          if (overdueCards.some(occ => occ.card.id === c.id)) continue;
          const cardInstallments = installments.filter((inst: Installment) => inst.cardId === c.id);
          const cardDueDate = new Date(selYear, selMonth, c.dueDate);
          const isOverdue = cardDueDate < today;
          const unpaidPayments = cardPayments.filter(p => p.status !== 'paid');
          // Only create a card-group row when there are still unpaid items to show
          if (!unpaidPayments.length) continue;
          const lines = unpaidPayments.map(p => {
            const inst = cardInstallments.find((i: Installment) => i.id === p.installmentId);
            return { transaction: inst?.transaction ?? 'Installment', amount: p.amount, paymentId: p.id, dueDate: p.dueDate };
          });
          const unpaidAmount = unpaidPayments.reduce((s, p) => s + p.amount, 0);
          if (isOverdue) {
            selMonthCardItems.push({
              kind: 'overdueCard',
              statusLabel: 'overdue',
              sortDate: cardDueDate.toISOString(),
              item: { card: c, dueDate: cardDueDate, unpaidAmount, lines },
            });
          } else {
            selMonthCardItems.push({
              kind: 'upcomingCard',
              statusLabel: 'upcoming',
              sortDate: cardDueDate.toISOString(),
              item: { card: c, dueDate: cardDueDate, pendingAmount: unpaidAmount, lines },
            });
          }
        }

        const getAmount = (t: MonthTransactionVM): number => {
          if (t.kind === 'expense')      return t.item.amount;
          if (t.kind === 'payment')      return t.item.amount;
          if (t.kind === 'overdueCard')  return t.item.unpaidAmount;
          return (t.item as UpcomingCardVM).pendingAmount;
        };

        const allMonthTransactions: MonthTransactionVM[] = [
          ...monthlyExpenseItems,
          ...monthlyPaymentItems,
          ...overdueCardItems,
          ...selMonthCardItems,
        ].sort((a, b) => {
          if (sortBy === 'date-desc')   return new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
          if (sortBy === 'date-asc')    return new Date(a.sortDate).getTime() - new Date(b.sortDate).getTime();
          if (sortBy === 'amount-desc') return getAmount(b) - getAmount(a);
          if (sortBy === 'amount-asc')  return getAmount(a) - getAmount(b);
          // Default 'status': overdue → upcoming → paid, then date asc
          const so = statusOrder[a.statusLabel] - statusOrder[b.statusLabel];
          return so !== 0 ? so : new Date(a.sortDate).getTime() - new Date(b.sortDate).getTime();
        });

        const unpaidTransactions = allMonthTransactions.filter(t => t.statusLabel !== 'paid');
        const paidTransactions   = allMonthTransactions.filter(t => t.statusLabel === 'paid');

        // Recurring: current-month expenses marked as recurring
        const recurringExpenses = expenses.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === currentYear && d.getMonth() === currentMonth && e.recurring;
        });
        const recurringTotal = recurringExpenses.reduce((s, e) => s + e.amount, 0);
        // Pending: current-month unpaid non-recurring expenses
        const pendingExpenses = expenses.filter(e => {
          const d = new Date(e.date);
          return d.getFullYear() === currentYear && d.getMonth() === currentMonth &&
            !e.recurring && e.status !== 'paid';
        });

        return {
          summary,
          incomes: incomeVMs,
          monthlyIncome,
          unpaidTransactions,
          paidTransactions,
          monthlyTotal,
          overdueTotal,
          insights,
          savingsGoals,
          cardCharges,
          recurringTotal,
          recurringExpenses,
          pendingExpenses,
        };
      })
    );
    this.vm$.subscribe(vm => { this.latestIncomes = vm.incomes; });
  }

  async handleRefresh(event: CustomEvent): Promise<void> {
    await this.engine.loadAll();
    this.buildVM();
    (event.target as HTMLIonRefresherElement).complete();
  }

  // ─── Income CRUD ─────────────────────────────────────────────────
  openAddIncome(): void {
    this.editingIncome = null;
    this.incomeForm = this.blankIncome();
    this.isIncomeModalOpen = true;
  }

  openEditIncome(income: Income): void {
    this.editingIncome = income;
    this.incomeForm = { ...income };
    this.isIncomeModalOpen = true;
  }

  closeIncomeModal(): void {
    this.isIncomeModalOpen = false;
    this.editingIncome = null;
  }

  async saveIncome(): Promise<void> {
    const { name, source, amount, date, recurring } = this.incomeForm;
    if (!source || !amount || !date) return;
    if (this.editingIncome) {
      await this.engine.updateIncome({ ...this.editingIncome, name: name || '', source, amount: +amount, date, recurring: !!recurring });
    } else {
      await this.engine.addIncome({ name: name || '', source, amount: +amount, date, recurring: !!recurring });
    }
    this.closeIncomeModal();
  }

  async deleteIncome(id: string): Promise<void> {
    await this.engine.deleteIncome(id);
  }

  goToIncomeDetail(id: string): void {
    this.router.navigate(['/income', id]);
  }

  private blankIncome(): Partial<Income> {
    return {
      name: '',
      source: 'Salary',
      amount: undefined,
      date: new Date().toISOString().split('T')[0],
      recurring: false,
    };
  }

  // ─── Savings Goals CRUD ──────────────────────────────────────────────
  openAddGoal(): void {
    this.editingGoal = null;
    this.goalForm = this.blankGoal();
    this.isGoalModalOpen = true;
  }

  openEditGoal(goal: SavingsGoal): void {
    this.editingGoal = goal;
    this.goalForm = { ...goal };
    this.isGoalModalOpen = true;
  }

  closeGoalModal(): void {
    this.isGoalModalOpen = false;
    this.editingGoal = null;
  }

  async saveGoal(): Promise<void> {
    const { name, targetAmount, icon, color, deadline, notes } = this.goalForm;
    if (!name || !targetAmount) return;
    if (this.editingGoal) {
      await this.goalService.updateGoal({ ...this.editingGoal, name, targetAmount: +targetAmount, icon: icon || 'flag-outline', color: color || '#4ade80', deadline, notes });
    } else {
      await this.goalService.addGoal({ name, targetAmount: +targetAmount, icon: icon || 'flag-outline', color: color || '#4ade80', deadline, notes });
    }
    this.closeGoalModal();
  }

  async deleteGoal(id: string): Promise<void> {
    await this.goalService.deleteGoal(id);
  }

  openContribute(goal: SavingsGoalVM, mode: 'add' | 'withdraw'): void {
    this.contributeGoal = goal;
    this.contributeAmount = 0;
    this.contributeMode = mode;
    this.isContributeModalOpen = true;
  }

  closeContributeModal(): void {
    this.isContributeModalOpen = false;
    this.contributeGoal = null;
  }

  async confirmContribute(): Promise<void> {
    if (!this.contributeGoal || !this.contributeAmount) return;
    if (this.contributeMode === 'add') {
      await this.goalService.contribute(this.contributeGoal.id, +this.contributeAmount);
    } else {
      await this.goalService.withdraw(this.contributeGoal.id, +this.contributeAmount);
    }
    this.closeContributeModal();
  }

  private blankGoal(): Partial<SavingsGoal> {
    return { name: '', targetAmount: undefined, icon: 'flag-outline', color: '#4ade80', deadline: '', notes: '' };
  }

  // ─── Month / Sort Filter ──────────────────────────────────────────────
  readonly MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  private _viewYear$  = new BehaviorSubject<number>(new Date().getFullYear());
  private _viewMonth$ = new BehaviorSubject<number>(new Date().getMonth());
  private _txSortBy$  = new BehaviorSubject<string>('status');
  showPaidTx = false;

  get viewYear(): number  { return this._viewYear$.value; }
  get viewMonth(): number { return this._viewMonth$.value; }
  get txSortBy(): string  { return this._txSortBy$.value; }
  get isCurrentMonth(): boolean {
    const n = new Date();
    return this.viewYear === n.getFullYear() && this.viewMonth === n.getMonth();
  }

  prevMonth(): void {
    let y = this._viewYear$.value, m = this._viewMonth$.value - 1;
    if (m < 0) { m = 11; y -= 1; }
    this._viewYear$.next(y); this._viewMonth$.next(m);
    this.showPaidTx = false;
  }
  nextMonth(): void {
    let y = this._viewYear$.value, m = this._viewMonth$.value + 1;
    if (m > 11) { m = 0; y += 1; }
    this._viewYear$.next(y); this._viewMonth$.next(m);
    this.showPaidTx = false;
  }
  goToCurrentMonth(): void {
    const n = new Date();
    this._viewYear$.next(n.getFullYear()); this._viewMonth$.next(n.getMonth());
    this.showPaidTx = false;
  }
  setSortBy(v: string): void { this._txSortBy$.next(v); }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: this.currencyCode, maximumFractionDigits: 0 }).format(amount);
  }
}
