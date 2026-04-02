import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons,
  IonIcon, IonLabel, IonBadge, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
  IonModal, IonInput, IonSelect, IonSelectOption, IonToggle,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, walletOutline, pricetagOutline, cardOutline, closeOutline,
  trashOutline, createOutline, saveOutline, checkmarkCircleOutline, warningOutline,
} from 'ionicons/icons';
import { Subscription, combineLatest } from 'rxjs';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { Income, PaymentAllocation, Expense, InstallmentPayment, Installment } from '../../core/models';

const INCOME_SOURCES = ['Salary', 'Freelance', 'Business', 'Investment', 'Bonus', 'Other'];

interface LinkedItem {
  allocationId: string;
  type: 'expense' | 'installment';
  name: string;
  date: string;
  paidAt?: string;
  allocatedAmount: number;
}

@Component({
  selector: 'app-income-detail',
  standalone: true,
  imports: [
    CommonModule, CurrencyPipe, DatePipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons,
    IonIcon, IonLabel, IonBadge, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
    IonModal, IonInput, IonSelect, IonSelectOption, IonToggle,
  ],
  templateUrl: './income-detail.component.html',
})
export class IncomeDetailComponent implements OnInit, OnDestroy {
  income: Income | null = null;
  linkedItems: LinkedItem[] = [];
  usedAmount = 0;
  remainingAmount = 0;
  usagePercent = 0;
  currencyCode = 'PHP';

  // Edit modal
  isEditModalOpen = false;
  incomeSources = INCOME_SOURCES;
  incomeForm: Partial<Income> = {};

  // Alloc planner
  isAllocPlannerOpen = false;
  allocPlannerExpenses: Array<Expense & { selected: boolean }> = [];
  allocPlannerInProgress = false;

  get allocPlannerSelectedTotal(): number {
    return this.allocPlannerExpenses.filter(e => e.selected).reduce((s, e) => s + e.amount, 0);
  }

  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private engine: FinancialEngineService,
    private prefs: PreferencesService,
  ) {
    addIcons({
      arrowBackOutline, walletOutline, pricetagOutline, cardOutline, closeOutline,
      trashOutline, createOutline, saveOutline, checkmarkCircleOutline, warningOutline,
    });
  }

  ngOnInit(): void {
    this.currencyCode = this.prefs.currentCurrencyCode;
    const id = this.route.snapshot.paramMap.get('id') || '';

    this.sub = combineLatest([
      this.engine.getIncomes(),
      this.engine.getAllocations(),
      this.engine.getExpenses(),
      this.engine.getInstallmentPayments(),
      this.engine.getInstallments(),
    ]).subscribe(([incomes, allocations, expenses, payments, installments]) => {
      this.income = incomes.find(i => i.id === id) || null;
      if (!this.income) return;

      const myAllocs = allocations.filter(a => a.incomeId === id);
      this.usedAmount = myAllocs.reduce((s, a) => s + a.amount, 0);
      this.remainingAmount = this.income.amount - this.usedAmount;
      this.usagePercent = this.income.amount > 0 ? Math.min(100, (this.usedAmount / this.income.amount) * 100) : 0;

      this.linkedItems = myAllocs.map(alloc => {
        if (alloc.expenseId) {
          const exp = expenses.find(e => e.id === alloc.expenseId);
          return {
            allocationId: alloc.id,
            type: 'expense' as const,
            name: exp?.category || 'Unknown Expense',
            date: exp?.date || '',
            paidAt: exp?.paidAt,
            allocatedAmount: alloc.amount,
          };
        } else if (alloc.installmentPaymentId) {
          const pay = payments.find(p => p.id === alloc.installmentPaymentId);
          const inst = pay ? installments.find(i => i.id === pay.installmentId) : null;
          return {
            allocationId: alloc.id,
            type: 'installment' as const,
            name: inst?.transaction || 'Installment Payment',
            date: pay?.dueDate || '',
            paidAt: pay?.paidAt,
            allocatedAmount: alloc.amount,
          };
        }
        return {
          allocationId: alloc.id,
          type: 'expense' as const,
          name: 'Unknown',
          date: '',
          allocatedAmount: alloc.amount,
        };
      });
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async unlinkAllocation(allocationId: string): Promise<void> {
    await this.engine.removeAllocation(allocationId);
  }

  openEdit(): void {
    if (!this.income) return;
    this.incomeForm = { ...this.income };
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
  }

  async saveIncome(): Promise<void> {
    if (!this.income) return;
    const { name, source, amount, date, recurring } = this.incomeForm;
    if (!source || !amount || !date) return;
    await this.engine.updateIncome({ ...this.income, name: name || '', source, amount: +amount, date, recurring: !!recurring });
    this.closeEditModal();
  }

  async deleteIncome(): Promise<void> {
    if (!this.income) return;
    await this.engine.deleteIncome(this.income.id);
    this.goBack();
  }

  openAllocPlanner(): void {
    let snapshot: Expense[] = [];
    this.engine.getExpenses().subscribe(list => snapshot = list).unsubscribe();
    this.allocPlannerExpenses = snapshot
      .filter(e => e.status !== 'paid')
      .map(e => ({ ...e, selected: false }));
    this.isAllocPlannerOpen = true;
  }

  closeAllocPlanner(): void {
    this.isAllocPlannerOpen = false;
    this.allocPlannerExpenses = [];
  }

  toggleAllocExpense(id: string): void {
    const e = this.allocPlannerExpenses.find(x => x.id === id);
    if (e) e.selected = !e.selected;
  }

  async confirmAllocPlan(): Promise<void> {
    if (!this.income || this.allocPlannerInProgress) return;
    const selected = this.allocPlannerExpenses.filter(e => e.selected);
    if (!selected.length) return;
    this.allocPlannerInProgress = true;
    try {
      for (const e of selected) {
        await this.engine.payExpenseWithIncomes(e, [{ incomeId: this.income.id, amount: e.amount }]);
      }
    } finally {
      this.allocPlannerInProgress = false;
      this.closeAllocPlanner();
    }
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
