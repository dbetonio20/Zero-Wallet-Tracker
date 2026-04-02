import { Component, OnInit } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
  IonBadge, IonFab, IonFabButton, IonIcon, IonModal, IonButton, IonButtons,
  IonInput, IonSelect, IonSelectOption, IonAccordion, IonAccordionGroup,
  IonItemSliding, IonItemOptions, IonItemOption, IonNote,
  IonSegment, IonSegmentButton, IonCard, IonCardHeader, IonCardTitle,
  IonCardSubtitle, IonCardContent, AlertController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, trashOutline, checkmarkOutline, chevronDownOutline,
  cardOutline, settingsOutline, createOutline,
} from 'ionicons/icons';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { Installment, InstallmentPayment, CreditCard, PaymentStatus, Income, Expense } from '../../core/models';
import { PayModalComponent, PayModalResult } from '../shared/pay-modal/pay-modal.component';

interface InstallmentVM extends Installment {
  cardName: string;
  payments: InstallmentPayment[];
  paidCount: number;
  remainingMonths: number;
  totalCost: number;
  paidAmount: number;
  remainingAmount: number;
}

interface BillingCycleGroup {
  label: string;      // e.g. 'Due Apr 20, 2026'
  dueDate: Date;
  expenses: (Expense & { billingDueDate: Date })[];
  total: number;
}

interface CardWithExpensesVM {
  card: CreditCard;
  cycles: BillingCycleGroup[];
  expenses: Expense[];
  total: number;
}

@Component({
  selector: 'app-debts',
  standalone: true,
  imports: [
    AsyncPipe, CurrencyPipe, DatePipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
    IonBadge, IonFab, IonFabButton, IonIcon, IonModal, IonButton, IonButtons,
    IonInput, IonSelect, IonSelectOption, IonAccordion, IonAccordionGroup,
    IonItemSliding, IonItemOptions, IonItemOption, IonNote,
    IonSegment, IonSegmentButton, IonCard, IonCardHeader, IonCardTitle,
    IonCardSubtitle, IonCardContent,
    PayModalComponent,
  ],
  templateUrl: './debts.component.html',
})
export class DebtsComponent implements OnInit {
  activeSegment = 'installments';
  userName = 'U';
  userInitial = 'U';
  currencyCode = 'PHP';

  vm$!: Observable<InstallmentVM[]>;
  cards$!: Observable<CreditCard[]>;
  cardsWithExpenses$!: Observable<CardWithExpensesVM[]>;
  isInstallmentModalOpen = false;
  isCardModalOpen = false;
  isPayModalOpen = false;
  payingPayment: InstallmentPayment | null = null;
  payingTransaction = '';
  editingInstallment: Installment | null = null;
  editingCard: CreditCard | null = null;
  isEditPaymentModalOpen = false;
  editingPayment: InstallmentPayment | null = null;
  paymentPaidAtForm = '';
  paymentForm: { amount: number | undefined; dueDate: string; status: PaymentStatus } = this.blankPaymentForm();

  installmentForm: Partial<Installment & { cardName: string }> = this.blankInstallmentForm();
  cardForm: Partial<CreditCard> = this.blankCardForm();

  constructor(
    private engine: FinancialEngineService,
    private cardService: CreditCardService,
    private prefs: PreferencesService,
    private router: Router,
    private alertCtrl: AlertController,
  ) {
    addIcons({ addOutline, trashOutline, checkmarkOutline, chevronDownOutline, cardOutline, settingsOutline, createOutline });
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.userInitial = this.prefs.getUserInitial(this.userName);
    this.currencyCode = this.prefs.currentCurrencyCode;

    this.cards$ = this.cardService.getCards();
    this.cardsWithExpenses$ = combineLatest([
      this.cardService.getCards(),
      this.engine.getExpenses(),
    ]).pipe(
      map(([cards, expenses]) =>
        cards.map(card => {
          const linked = expenses.filter(e => e.creditCardId === card.id);
          const total = linked.reduce((s, e) => s + e.amount, 0);
          // Annotate each expense with its billing-cycle due date
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
          return { card, cycles, expenses: linked, total };
        })
      )
    );
    this.vm$ = combineLatest([
      this.engine.getInstallments(),
      this.engine.getInstallmentPayments(),
    ]).pipe(
      map(([installments, payments]) =>
        installments.map(inst => {
          const instPayments = payments.filter(p => p.installmentId === inst.id);
          const paidCount = instPayments.filter(p => p.status === 'paid').length;
          const card = this.cardService.getById(inst.cardId);
          const totalCost = inst.monthlyAmount * inst.months;
          const paidAmount = instPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
          return {
            ...inst,
            cardName: card ? `${card.bank} – ${card.name}` : 'No Card',
            payments: instPayments,
            paidCount,
            remainingMonths: inst.months - paidCount,
            totalCost,
            paidAmount,
            remainingAmount: totalCost - paidAmount,
          };
        })
      )
    );
  }

  goToSettings(): void {
    this.router.navigate(['/settings']);
  }

  // ─── Installment ─────────────────────────────────────────────────
  openInstallmentModal(): void { this.editingInstallment = null; this.installmentForm = this.blankInstallmentForm(); this.isInstallmentModalOpen = true; }
  openEditInstallment(inst: InstallmentVM): void {
    this.editingInstallment = inst;
    this.installmentForm = { ...inst };
    this.isInstallmentModalOpen = true;
  }
  closeInstallmentModal(): void { this.isInstallmentModalOpen = false; this.editingInstallment = null; }

  async saveInstallment(): Promise<void> {
    if (!this.installmentForm.transaction || !this.installmentForm.monthlyAmount || !this.installmentForm.startDate || !this.installmentForm.months) return;
    if (this.editingInstallment) {
      await this.engine.updateInstallment({
        ...this.editingInstallment,
        cardId: this.installmentForm.cardId || '',
        transaction: this.installmentForm.transaction!,
        monthlyAmount: +this.installmentForm.monthlyAmount!,
        startDate: this.installmentForm.startDate!,
        months: +this.installmentForm.months!,
        frequency: this.installmentForm.frequency ?? 'monthly',
      });
    } else {
      await this.engine.addInstallment({
        cardId: this.installmentForm.cardId || '',
        transaction: this.installmentForm.transaction!,
        monthlyAmount: +this.installmentForm.monthlyAmount!,
        startDate: this.installmentForm.startDate!,
        months: +this.installmentForm.months!,
        frequency: this.installmentForm.frequency ?? 'monthly',
      });
    }
    this.closeInstallmentModal();
  }

  async markPaid(payment: InstallmentPayment, transactionName?: string): Promise<void> {
    this.payingPayment = payment;
    this.payingTransaction = transactionName || 'Installment';
    this.isPayModalOpen = true;
  }

  closePayModal(): void {
    this.isPayModalOpen = false;
    this.payingPayment = null;
    this.payingTransaction = '';
  }

  async onPayResult(result: PayModalResult): Promise<void> {
    if (!this.payingPayment) return;
    if (result.withoutIncome) {
      await this.engine.markPayment(this.payingPayment.id, 'paid');
    } else {
      await this.engine.payInstallmentWithIncomes(this.payingPayment, result.allocations);
    }
    this.closePayModal();
  }

  getPaymentIncomeSources(paymentId: string): string {
    const allocs = this.engine.getAllocationsForInstallmentPayment(paymentId);
    if (!allocs.length) return '';
    const incomes: Income[] = [];
    this.engine.getIncomes().subscribe(list => incomes.push(...list)).unsubscribe();
    return allocs.map(a => {
      const inc = incomes.find(i => i.id === a.incomeId);
      return inc ? inc.source : 'Unknown';
    }).join(', ');
  }

  // ─── Individual Payment Edit/Delete ───────────────────────────
  openEditPayment(payment: InstallmentPayment): void {
    this.editingPayment = payment;
    this.paymentForm = { amount: payment.amount, dueDate: payment.dueDate, status: payment.status };
    this.paymentPaidAtForm = payment.paidAt ?? '';
    this.isEditPaymentModalOpen = true;
  }

  closeEditPaymentModal(): void {
    this.isEditPaymentModalOpen = false;
    this.editingPayment = null;
    this.paymentPaidAtForm = '';
  }

  async savePayment(): Promise<void> {
    if (!this.editingPayment || !this.paymentForm.amount || !this.paymentForm.dueDate) return;
    // If status is changing away from 'paid', remove income allocations so income is freed
    if (this.editingPayment.status === 'paid' && this.paymentForm.status !== 'paid') {
      await this.engine.removeAllocationsForPayment(this.editingPayment.id);
    }
    const paidAt = this.paymentForm.status === 'paid'
      ? (this.paymentPaidAtForm || this.editingPayment.paidAt || new Date().toISOString().split('T')[0])
      : undefined;
    await this.engine.updateInstallmentPayment({
      ...this.editingPayment,
      amount: +this.paymentForm.amount,
      dueDate: this.paymentForm.dueDate,
      status: this.paymentForm.status,
      paidAt,
    });
    this.closeEditPaymentModal();
  }

  async deletePayment(payment: InstallmentPayment, transactionName?: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete Payment',
      message: `Delete the ${new Date(payment.dueDate).toLocaleDateString('en', { month: 'long', year: 'numeric' })} payment for "${transactionName || 'this installment'}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.engine.deleteInstallmentPayment(payment.id),
        },
      ],
    });
    await alert.present();
  }

  async deleteInstallment(id: string, name?: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete Installment',
      message: `Are you sure you want to delete "${name || 'this installment'}"? This will also remove all its payment records and linked income allocations.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.engine.deleteInstallment(id),
        },
      ],
    });
    await alert.present();
  }

  badgeColor(status: PaymentStatus): string {
    return status === 'paid' ? 'success' : status === 'overdue' ? 'danger' : 'warning';
  }

  totalCost(list: InstallmentVM[]): number {
    return list.reduce((s, i) => s + i.totalCost, 0);
  }

  totalPaid(list: InstallmentVM[]): number {
    return list.reduce((s, i) => s + i.paidAmount, 0);
  }

  totalRemaining(list: InstallmentVM[]): number {
    return list.reduce((s, i) => s + i.remainingAmount, 0);
  }

  // ─── Credit Card ─────────────────────────────────────────────────
  openCardModal(): void { this.editingCard = null; this.cardForm = this.blankCardForm(); this.isCardModalOpen = true; }
  openEditCard(card: CreditCard): void {
    this.editingCard = card;
    this.cardForm = { ...card };
    this.isCardModalOpen = true;
  }
  closeCardModal(): void { this.isCardModalOpen = false; this.editingCard = null; }

  async saveCard(): Promise<void> {
    if (!this.cardForm.bank || !this.cardForm.name) return;
    if (this.editingCard) {
      await this.cardService.updateCard({
        ...this.editingCard,
        bank: this.cardForm.bank!,
        name: this.cardForm.name!,
        dueDate: +(this.cardForm.dueDate ?? 1),
        cutoffDate: +(this.cardForm.cutoffDate ?? 25),
        creditLimit: +(this.cardForm.creditLimit ?? 0),
      });
    } else {
      await this.cardService.addCard({
        bank: this.cardForm.bank!,
        name: this.cardForm.name!,
        dueDate: +(this.cardForm.dueDate ?? 1),
        cutoffDate: +(this.cardForm.cutoffDate ?? 25),
        creditLimit: +(this.cardForm.creditLimit ?? 0),
      });
    }
    this.closeCardModal();
  }

  async deleteCard(id: string, name?: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remove Credit Card',
      message: `Are you sure you want to remove "${name || 'this card'}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => this.cardService.deleteCard(id),
        },
      ],
    });
    await alert.present();
  }

  nextDueDate(card: CreditCard): Date {
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), card.dueDate);
    if (due <= today) due.setMonth(due.getMonth() + 1);
    return due;
  }

  ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  openAddModal(): void {
    if (this.activeSegment === 'installments') {
      this.openInstallmentModal();
    } else {
      this.openCardModal();
    }
  }

  private blankInstallmentForm(): Partial<Installment & { cardName: string }> {
    return {
      transaction: '',
      monthlyAmount: undefined,
      startDate: new Date().toISOString().split('T')[0],
      months: 12,
      cardId: '',
      frequency: 'monthly',
    };
  }

  private blankCardForm(): Partial<CreditCard> {
    return { bank: '', name: '', dueDate: 1, cutoffDate: 25, creditLimit: 0 };
  }

  private blankPaymentForm(): { amount: number | undefined; dueDate: string; status: PaymentStatus } {
    return { amount: undefined, dueDate: '', status: 'pending' };
  }
}
