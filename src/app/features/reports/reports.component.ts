import { Component, OnInit } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, IonProgressBar, IonBadge,
} from '@ionic/angular/standalone';
import { BaseChartDirective } from 'ng2-charts';
import {
  Chart, ArcElement, Tooltip, Legend, DoughnutController,
  BarController, BarElement, LineController, LineElement,
  PointElement, CategoryScale, LinearScale, Filler,
} from 'chart.js';
import { addIcons } from 'ionicons';
import { settingsOutline } from 'ionicons/icons';
import { Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { CategoryService } from '../../core/services/category.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { Expense, Income, Installment, InstallmentPayment, CreditCard } from '../../core/models';
import { ChartData, ChartOptions } from 'chart.js';

Chart.register(
  ArcElement, Tooltip, Legend, DoughnutController,
  BarController, BarElement, LineController, LineElement,
  PointElement, CategoryScale, LinearScale, Filler,
);



const INCOME_SOURCE_COLORS: Record<string, string> = {
  Salary: '#3b82f6',
  Freelance: '#c084fc',
  Business: '#f97316',
  Investment: '#14b8a6',
  Bonus: '#facc15',
  Other: '#94a3b8',
};

const PAYMENT_METHOD_COLORS = ['#4ade80', '#3b82f6', '#facc15', '#ec4899', '#f97316', '#14b8a6', '#c084fc'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarDay {
  day: number | null;
  hasExpense: boolean;
  isToday: boolean;
  isHighSpend: boolean;
  total: number;
}

interface CategoryBreakdown {
  category: string;
  amount: number;
  color: string;
}

interface InstallmentOverviewVM {
  id: string;
  transaction: string;
  cardName: string;
  monthlyAmount: number;
  months: number;
  paidCount: number;
  progress: number;
  totalCost: number;
  paidAmount: number;
  monthlyDue: number;
  monthlyPaid: number;
}

interface CardUtilizationVM extends CreditCard {
  unpaidBalance: number;
  utilizationPercent: number;
  isHigh: boolean;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CurrencyPipe, DecimalPipe, FormsModule,
    IonHeader, IonToolbar, IonContent, IonButton, IonIcon,
    IonSegment, IonSegmentButton, IonLabel, IonProgressBar, IonBadge,
    BaseChartDirective,
  ],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  userName = 'U';
  userInitial = 'U';
  currencyCode = 'PHP';
  currencySymbol = '₱';

  selectedYear: number;
  selectedMonth: number;
  years: number[] = [];
  months = MONTH_NAMES;
  activeSegment = 'expenses';

  allExpenses: Expense[] = [];
  allIncomes: Income[] = [];
  allInstallments: Installment[] = [];
  allInstallmentPayments: InstallmentPayment[] = [];
  allCards: CreditCard[] = [];

  filteredExpenses: Expense[] = [];
  filteredIncomes: Income[] = [];

  totalForMonth = 0;
  avgPerDay = 0;
  categories: CategoryBreakdown[] = [];
  calendarWeeks: CalendarDay[][] = [];
  donutData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  donutOptions: ChartOptions<'doughnut'> = this.makeDonutOptions();

  incomeTotal = 0;
  incomeSourceBreakdown: { source: string; amount: number; color: string }[] = [];
  incomeDonutData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  incomeDonutOptions: ChartOptions<'doughnut'> = this.makeDonutOptions();

  incomeVsExpensesData: ChartData<'bar'> = { labels: [], datasets: [] };
  incomeVsExpensesOptions: ChartOptions<'bar'> = {
    responsive: true,
    plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };

  cashFlowData: ChartData<'line'> = { labels: [], datasets: [] };
  cashFlowOptions: ChartOptions<'line'> = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };
  cashFlowMonths: { label: string; income: number; expenses: number; installments: number; balance: number }[] = [];

  paymentMethodBreakdown: { method: string; amount: number; color: string }[] = [];
  paymentMethodData: ChartData<'bar'> = { labels: [], datasets: [] };
  paymentMethodOptions: ChartOptions<'bar'> = {
    indexAxis: 'y' as const,
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };

  installmentOverview: InstallmentOverviewVM[] = [];
  installmentMonthTotal = 0;
  installmentMonthPaid = 0;
  installmentGrandTotal = 0;
  installmentGrandPaid = 0;

  cardUtilization: CardUtilizationVM[] = [];

  get currentMonthIncome(): number { return this.cashFlowMonths[this.cashFlowMonths.length - 1]?.income ?? 0; }
  get currentMonthSpend(): number {
    const m = this.cashFlowMonths[this.cashFlowMonths.length - 1];
    return m ? m.expenses + m.installments : 0;
  }
  get currentMonthBalance(): number { return this.cashFlowMonths[this.cashFlowMonths.length - 1]?.balance ?? 0; }

  constructor(
    private engine: FinancialEngineService,
    private cardService: CreditCardService,
    private categoryService: CategoryService,
    private prefs: PreferencesService,
    private router: Router,
  ) {
    addIcons({ settingsOutline });
    const now = new Date();
    this.selectedYear = now.getFullYear();
    this.selectedMonth = now.getMonth();
    this.years = [now.getFullYear() - 1, now.getFullYear()];
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.userInitial = this.prefs.getUserInitial(this.userName);
    this.currencyCode = this.prefs.currentCurrencyCode;
    this.currencySymbol = this.prefs.currentCurrencySymbol;
    this.refreshTooltips();

    combineLatest([
      this.engine.getExpenses(),
      this.engine.getIncomes(),
      this.engine.getInstallments(),
      this.engine.getInstallmentPayments(),
      this.cardService.getCards(),
    ]).subscribe(([expenses, incomes, installments, payments, cards]) => {
      this.allExpenses = expenses;
      this.allIncomes = incomes;
      this.allInstallments = installments;
      this.allInstallmentPayments = payments;
      this.allCards = cards;
      this.rebuildView();
    });
  }

  goToSettings(): void { this.router.navigate(['/settings']); }
  selectYear(year: number): void { this.selectedYear = year; this.rebuildView(); }
  selectMonth(monthIndex: number): void { this.selectedMonth = monthIndex; this.rebuildView(); }

  private rebuildView(): void {
    this.filteredExpenses = this.allExpenses.filter(e => this.inMonth(e.date, this.selectedYear, this.selectedMonth));
    this.filteredIncomes = this.allIncomes.filter(i => this.inMonth(i.date, this.selectedYear, this.selectedMonth));
    this.totalForMonth = this.filteredExpenses.reduce((s, e) => s + e.amount, 0);
    const daysInMonth = new Date(this.selectedYear, this.selectedMonth + 1, 0).getDate();
    this.avgPerDay = daysInMonth > 0 ? this.totalForMonth / daysInMonth : 0;
    this.buildCategoryBreakdown();
    this.buildExpenseDonut();
    this.buildCalendar();
    this.buildIncomeSection();
    this.buildIncomeVsExpenses();
    this.buildCashFlow();
    this.buildPaymentMethods();
    this.buildInstallmentsOverview();
    this.buildCardUtilization();
  }

  private buildCategoryBreakdown(): void {
    const map = new Map<string, number>();
    this.filteredExpenses.forEach(e => map.set(e.category, (map.get(e.category) ?? 0) + e.amount));
    this.categories = [...map.entries()].map(([category, amount]) => ({
      category, amount, color: this.categoryService.getColor(category),
    }));
  }

  private buildExpenseDonut(): void {
    this.donutData = {
      labels: this.categories.map(c => c.category),
      datasets: [{ data: this.categories.map(c => c.amount), backgroundColor: this.categories.map(c => c.color), borderWidth: 0, hoverOffset: 4 }],
    };
  }

  private buildCalendar(): void {
    const firstDay = new Date(this.selectedYear, this.selectedMonth, 1).getDay();
    const daysInMonth = new Date(this.selectedYear, this.selectedMonth + 1, 0).getDate();
    const today = new Date();
    const dailyTotals = new Map<number, number>();
    this.filteredExpenses.forEach(e => {
      const day = new Date(e.date).getDate();
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + e.amount);
    });
    const maxDaily = Math.max(...dailyTotals.values(), 0);
    const highThreshold = maxDaily * 0.6;
    const days: CalendarDay[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ day: null, hasExpense: false, isToday: false, isHighSpend: false, total: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const total = dailyTotals.get(d) ?? 0;
      const isToday = today.getFullYear() === this.selectedYear && today.getMonth() === this.selectedMonth && today.getDate() === d;
      days.push({ day: d, hasExpense: total > 0, isToday, isHighSpend: total >= highThreshold && total > 0, total });
    }
    this.calendarWeeks = [];
    for (let i = 0; i < days.length; i += 7) {
      const week = days.slice(i, i + 7);
      while (week.length < 7) week.push({ day: null, hasExpense: false, isToday: false, isHighSpend: false, total: 0 });
      this.calendarWeeks.push(week);
    }
  }

  private buildIncomeSection(): void {
    this.incomeTotal = this.filteredIncomes.reduce((s, i) => s + i.amount, 0);
    const map = new Map<string, number>();
    this.filteredIncomes.forEach(i => map.set(i.source, (map.get(i.source) ?? 0) + i.amount));
    this.incomeSourceBreakdown = [...map.entries()].map(([source, amount]) => ({
      source, amount, color: INCOME_SOURCE_COLORS[source] || '#94a3b8',
    }));
    this.incomeDonutData = {
      labels: this.incomeSourceBreakdown.map(s => s.source),
      datasets: [{ data: this.incomeSourceBreakdown.map(s => s.amount), backgroundColor: this.incomeSourceBreakdown.map(s => s.color), borderWidth: 0, hoverOffset: 4 }],
    };
  }

  private buildIncomeVsExpenses(): void {
    const months = this.getLast6Months();
    const incomeData = months.map(m => this.allIncomes.filter(i => this.inMonth(i.date, m.year, m.month)).reduce((s, i) => s + i.amount, 0));
    const expenseData = months.map(m => this.allExpenses.filter(e => this.inMonth(e.date, m.year, m.month)).reduce((s, e) => s + e.amount, 0));
    const installData = months.map(m => this.allInstallmentPayments.filter(p => p.status === 'paid' && this.inMonth(p.dueDate, m.year, m.month)).reduce((s, p) => s + p.amount, 0));
    this.incomeVsExpensesData = {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'Income', data: incomeData, backgroundColor: '#4ade80', borderRadius: 4 } as any,
        { label: 'Expenses', data: expenseData, backgroundColor: '#f87171', borderRadius: 4 } as any,
        { label: 'Installments', data: installData, backgroundColor: '#fb923c', borderRadius: 4 } as any,
      ],
    };
  }

  private buildCashFlow(): void {
    const months = this.getLast6Months();
    this.cashFlowMonths = months.map(m => {
      const income = this.allIncomes.filter(i => this.inMonth(i.date, m.year, m.month)).reduce((s, i) => s + i.amount, 0);
      const expenses = this.allExpenses.filter(e => this.inMonth(e.date, m.year, m.month)).reduce((s, e) => s + e.amount, 0);
      const installments = this.allInstallmentPayments.filter(p => p.status === 'paid' && this.inMonth(p.dueDate, m.year, m.month)).reduce((s, p) => s + p.amount, 0);
      return { label: m.label, income, expenses, installments, balance: income - expenses - installments };
    });
    this.cashFlowData = {
      labels: this.cashFlowMonths.map(m => m.label),
      datasets: [{
        label: 'Balance', data: this.cashFlowMonths.map(m => m.balance),
        borderColor: '#4ade80', backgroundColor: 'rgba(74, 222, 128, 0.15)',
        fill: true, tension: 0.4, pointBackgroundColor: '#4ade80', pointRadius: 4,
      }] as any,
    };
  }

  private buildPaymentMethods(): void {
    const map = new Map<string, number>();
    this.filteredExpenses.forEach(e => map.set(e.paymentMethod, (map.get(e.paymentMethod) ?? 0) + e.amount));
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    this.paymentMethodBreakdown = entries.map(([method, amount], i) => ({
      method, amount, color: PAYMENT_METHOD_COLORS[i % PAYMENT_METHOD_COLORS.length],
    }));
    this.paymentMethodData = {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: 'Amount', data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => PAYMENT_METHOD_COLORS[i % PAYMENT_METHOD_COLORS.length]),
        borderRadius: 4,
      }] as any,
    };
  }

  private buildInstallmentsOverview(): void {
    this.installmentOverview = this.allInstallments.map(inst => {
      const payments = this.allInstallmentPayments.filter(p => p.installmentId === inst.id);
      const monthPayments = payments.filter(p => this.inMonth(p.dueDate, this.selectedYear, this.selectedMonth));
      const paidCount = payments.filter(p => p.status === 'paid').length;
      const card = this.cardService.getById(inst.cardId);
      const paidAmount = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
      return {
        id: inst.id, transaction: inst.transaction,
        cardName: card ? card.bank + ' – ' + card.name : 'No Card',
        monthlyAmount: inst.monthlyAmount, months: inst.months, paidCount,
        progress: inst.months > 0 ? paidCount / inst.months : 0,
        totalCost: inst.monthlyAmount * inst.months, paidAmount,
        monthlyDue: monthPayments.reduce((s, p) => s + p.amount, 0),
        monthlyPaid: monthPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
      };
    });
    this.installmentMonthTotal = this.installmentOverview.reduce((s, i) => s + i.monthlyDue, 0);
    this.installmentMonthPaid = this.installmentOverview.reduce((s, i) => s + i.monthlyPaid, 0);
    this.installmentGrandTotal = this.installmentOverview.reduce((s, i) => s + i.totalCost, 0);
    this.installmentGrandPaid = this.installmentOverview.reduce((s, i) => s + i.paidAmount, 0);
  }

  private buildCardUtilization(): void {
    this.cardUtilization = this.allCards.map(card => {
      const linked = this.allInstallments.filter(i => i.cardId === card.id);
      const unpaid = this.allInstallmentPayments
        .filter(p => linked.some(i => i.id === p.installmentId) && p.status !== 'paid')
        .reduce((s, p) => s + p.amount, 0);
      const util = card.creditLimit > 0 ? unpaid / card.creditLimit : 0;
      return { ...card, unpaidBalance: unpaid, utilizationPercent: Math.min(util, 1), isHigh: util > 0.8 };
    });
  }

  private getLast6Months(): { year: number; month: number; label: string }[] {
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(this.selectedYear, this.selectedMonth - i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }) });
    }
    return result;
  }

  private inMonth(dateStr: string, year: number, month: number): boolean {
    const d = new Date(dateStr);
    return d.getFullYear() === year && d.getMonth() === month;
  }

  private makeDonutOptions(): ChartOptions<'doughnut'> {
    return {
      responsive: true, cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + this.currencySymbol + ctx.parsed.toLocaleString() } },
      },
    };
  }

  private refreshTooltips(): void {
    const cb = { label: (ctx: any) => ctx.label + ': ' + this.currencySymbol + ctx.parsed.toLocaleString() };
    this.donutOptions = { ...this.donutOptions, plugins: { ...this.donutOptions.plugins, tooltip: { callbacks: cb } } };
    this.incomeDonutOptions = { ...this.incomeDonutOptions, plugins: { ...this.incomeDonutOptions.plugins, tooltip: { callbacks: cb } } };
  }
}
