import { Component, OnInit } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonBadge, IonList, IonItem, IonLabel,
  IonRefresher, IonRefresherContent, IonIcon,
  IonModal, IonButton, IonButtons, IonInput, IonSelect, IonSelectOption,
  IonToggle, IonItemSliding, IonItemOptions, IonItemOption,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, createOutline, trashOutline, warningOutline,
  arrowDownOutline, arrowUpOutline, alertCircleOutline,
  timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
  settingsOutline, chevronForwardOutline,
} from 'ionicons/icons';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { FinancialSummary, Expense, InstallmentPayment, CreditCard, Income, PaymentAllocation } from '../../core/models';

const INCOME_SOURCES = ['Salary', 'Freelance', 'Business', 'Investment', 'Bonus', 'Other'];

interface IncomeVM extends Income {
  usedAmount: number;
  remainingAmount: number;
  usagePercent: number;
}

interface DashboardVM {
  summary: FinancialSummary;
  incomes: IncomeVM[];
  overdueExpenses: Expense[];
  upcomingExpenses: Expense[];
  overduePayments: InstallmentPayment[];
  upcomingPayments: InstallmentPayment[];
  upcomingCardDues: CreditCard[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    AsyncPipe, CurrencyPipe, DatePipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonBadge, IonList, IonItem, IonLabel,
    IonRefresher, IonRefresherContent, IonIcon,
    IonModal, IonButton, IonButtons, IonInput, IonSelect, IonSelectOption,
    IonToggle, IonItemSliding, IonItemOptions, IonItemOption,
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

  constructor(
    private engine: FinancialEngineService,
    private cardService: CreditCardService,
    private prefs: PreferencesService,
    private router: Router,
  ) {
    addIcons({
      addOutline, createOutline, trashOutline, warningOutline,
      arrowDownOutline, arrowUpOutline, alertCircleOutline,
      timeOutline, repeatOutline, cardOutline, walletOutline, closeOutline,
      settingsOutline, chevronForwardOutline,
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
    ]).pipe(
      map(([summary, incomes, expenses, payments, cards, allocations]) => {
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
        return {
          summary,
          incomes: incomeVMs,
          overdueExpenses: expenses.filter(e => e.status === 'overdue'),
          upcomingExpenses: expenses.filter(e => e.status === 'pending' && new Date(e.date) <= in7),
          overduePayments: payments.filter(p => p.status === 'overdue'),
          upcomingPayments: payments.filter(p => p.status === 'pending' && new Date(p.dueDate) <= in7),
          upcomingCardDues: cards.filter(c => {
            const due = new Date(today.getFullYear(), today.getMonth(), c.dueDate);
            if (due < today) due.setMonth(due.getMonth() + 1);
            return (due.getTime() - today.getTime()) / 86400000 <= 7;
          }),
        };
      })
    );
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
}
