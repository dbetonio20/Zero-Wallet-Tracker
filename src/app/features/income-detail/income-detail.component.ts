import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons,
  IonIcon, IonLabel, IonBadge, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, walletOutline, pricetagOutline, cardOutline, closeOutline } from 'ionicons/icons';
import { Subscription, combineLatest } from 'rxjs';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { Income, PaymentAllocation, Expense, InstallmentPayment, Installment } from '../../core/models';

interface LinkedItem {
  allocationId: string;
  type: 'expense' | 'installment';
  name: string;
  date: string;
  allocatedAmount: number;
}

@Component({
  selector: 'app-income-detail',
  standalone: true,
  imports: [
    CommonModule, CurrencyPipe, DatePipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons,
    IonIcon, IonLabel, IonBadge, IonItem, IonItemSliding, IonItemOptions, IonItemOption,
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

  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private engine: FinancialEngineService,
    private prefs: PreferencesService,
  ) {
    addIcons({ arrowBackOutline, walletOutline, pricetagOutline, cardOutline, closeOutline });
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

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
