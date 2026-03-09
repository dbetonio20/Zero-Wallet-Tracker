import { Component, OnInit } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonBadge, IonList, IonItem, IonLabel,
  IonRefresher, IonRefresherContent, IonIcon,
  IonModal, IonButton, IonButtons, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonItemSliding, IonItemOptions, IonItemOption, IonProgressBar,
  IonTextarea, IonFab, IonFabButton,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, createOutline, trashOutline, warningOutline,
  arrowDownOutline, arrowUpOutline, alertCircleOutline,
  timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
  settingsOutline, chevronForwardOutline, chevronDownOutline, checkmarkCircleOutline,
  trendingUpOutline, trendingDownOutline, saveOutline, bulbOutline,
  barbellOutline, leafOutline, ribbonOutline, flagOutline, removeOutline, addCircleOutline,
  receiptOutline,
} from 'ionicons/icons';
import { Observable, combineLatest } from 'rxjs';
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

interface UpcomingPaymentVM extends InstallmentPayment {
  transaction: string;
}

interface OverduePaymentVM extends InstallmentPayment {
  transaction: string;
}

interface CardChargesVM {
  card: CreditCard;
  expenses: Expense[];
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

interface DashboardVM {
  summary: FinancialSummary;
  incomes: IncomeVM[];
  overdueExpenses: Expense[];
  upcomingExpenses: Expense[];
  overduePayments: OverduePaymentVM[];
  upcomingPayments: UpcomingPaymentVM[];
  upcomingCards: UpcomingCardVM[];
  overdueCards: OverdueCardVM[];
  monthlyTotal: number;
  overdueTotal: number;
  insights: InsightItem[];
  savingsGoals: SavingsGoalVM[];
  cardCharges: CardChargesVM[];
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
    IonToggle, IonItemSliding, IonItemOptions, IonItemOption,
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
      arrowDownOutline, arrowUpOutline, alertCircleOutline,
      timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
      settingsOutline, chevronForwardOutline, chevronDownOutline, checkmarkCircleOutline,
      trendingUpOutline, trendingDownOutline, saveOutline, bulbOutline,
      barbellOutline, leafOutline, ribbonOutline, flagOutline, removeOutline, addCircleOutline,
      receiptOutline,
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
    ]).pipe(
      map(([summary, incomes, expenses, payments, cards, allocations, installments, goals]) => {
        const incomeVMs: IncomeVM[] = incomes.map(income => {
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

        // Total of all expenses + installment payments due in the current calendar month (any status)
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

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

        // Cards whose billing due date already passed — must not appear in Upcoming
        const overdueCardIds = new Set(overdueCards.map(occ => occ.card.id));

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
            .filter(e => { const d = new Date(e.date); return d.getFullYear() === currentYear && d.getMonth() === currentMonth; })
            .reduce((s, e) => s + e.amount, 0) +
          payments
            .filter(p => { const d = new Date(p.dueDate); return d.getFullYear() === currentYear && d.getMonth() === currentMonth; })
            .reduce((s, p) => s + p.amount, 0);

        // Card-linked installment IDs — separates card-grouped vs standalone payments
        const cardLinkedInstallmentIds = new Set(
          installments.filter((i: Installment) => i.cardId).map((i: Installment) => i.id)
        );

        // Upcoming card groups: find non-paid card-linked payments whose dueDate is within 7 days, group by card
        // Exclude payments belonging to cards already in overdueCards
        const upcomingCardPayments = payments.filter(p => {
          if (p.status === 'paid' || new Date(p.dueDate) > in7) return false;
          if (!cardLinkedInstallmentIds.has(p.installmentId)) return false;
          const inst = installments.find((i: Installment) => i.id === p.installmentId);
          return inst?.cardId ? !overdueCardIds.has(inst.cardId) : false;
        });
        const cardPaymentMap = new Map<string, { card: CreditCard; cardPayments: InstallmentPayment[] }>();
        for (const p of upcomingCardPayments) {
          const inst = installments.find((i: Installment) => i.id === p.installmentId);
          if (!inst?.cardId) continue;
          const card = cards.find(c => c.id === inst.cardId);
          if (!card) continue;
          if (!cardPaymentMap.has(card.id)) cardPaymentMap.set(card.id, { card, cardPayments: [] });
          cardPaymentMap.get(card.id)!.cardPayments.push(p);
        }
        const upcomingCards: UpcomingCardVM[] = Array.from(cardPaymentMap.values()).map(({ card: c, cardPayments }) => {
          const cardInstallments = installments.filter((inst: Installment) => inst.cardId === c.id);
          const due = new Date(currentYear, currentMonth, c.dueDate);
          const lines = cardPayments.map(p => {
            const inst = cardInstallments.find((i: Installment) => i.id === p.installmentId);
            return { transaction: inst?.transaction ?? 'Installment', amount: p.amount, paymentId: p.id, dueDate: p.dueDate };
          });
          const pendingAmount = cardPayments.reduce((s, p) => s + p.amount, 0);
          return { card: c, dueDate: due, pendingAmount, lines };
        });

        // Standalone upcoming payments (not card-linked) enriched with transaction name
        const upcomingPayments: UpcomingPaymentVM[] = payments
          .filter(p => p.status === 'pending' && new Date(p.dueDate) <= in7 && !cardLinkedInstallmentIds.has(p.installmentId))
          .map(p => {
            const inst = installments.find((i: Installment) => i.id === p.installmentId);
            return { ...p, transaction: inst?.transaction ?? 'Installment Payment' };
          });

        // ─── Credit Card Charges ─────────────────────────────────────
        const cardCharges: CardChargesVM[] = cards
          .map(card => {
            const linked = expenses.filter(e => e.creditCardId === card.id && e.status !== 'paid');
            const total = linked.reduce((s, e) => s + e.amount, 0);
            return { card, expenses: linked, total };
          })
          .filter(cc => cc.expenses.length > 0);

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

        // Savings rate: (totalIncome - totalThisMonth) / totalIncome
        const savingsRate = summary.totalIncome > 0
          ? Math.max(0, (summary.totalIncome - totalThisMonth) / summary.totalIncome)
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
        if (summary.totalIncome > 0) {
          insights.push({
            icon: 'leaf-outline',
            color: savingsRate >= 0.2 ? '#4ade80' : '#f97316',
            label: 'Savings rate',
            value: `${Math.round(savingsRate * 100)}%`,
            sub: savingsRate >= 0.2 ? 'Great job!' : 'Aim for 20%+',
          });
        }

        return {
          summary,
          incomes: incomeVMs,
          // Exclude CC-charged expenses — they are paid via the card bill, not individually
          overdueExpenses: expenses.filter(e => e.status === 'overdue' && !e.creditCardId),
          upcomingExpenses: expenses.filter(e => e.status === 'pending' && new Date(e.date) <= in7 && !e.creditCardId),
          overduePayments: payments.filter(p => {
            if (p.status !== 'overdue') return false;
            const inst = installments.find((i: Installment) => i.id === p.installmentId);
            return !inst?.cardId;
          }).map(p => {
            const inst = installments.find((i: Installment) => i.id === p.installmentId);
            return { ...p, transaction: inst?.transaction ?? 'Installment Payment' };
          }),
          upcomingPayments,
          upcomingCards,
          overdueCards,
          monthlyTotal,
          overdueTotal,
          insights,
          savingsGoals,
          cardCharges,
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
    const { source, amount, date, recurring } = this.incomeForm;
    if (!source || !amount || !date) return;
    if (this.editingIncome) {
      await this.engine.updateIncome({ ...this.editingIncome, source, amount: +amount, date, recurring: !!recurring });
    } else {
      await this.engine.addIncome({ source, amount: +amount, date, recurring: !!recurring });
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

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: this.currencyCode, maximumFractionDigits: 0 }).format(amount);
  }
}
