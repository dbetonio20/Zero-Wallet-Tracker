import { Component, OnInit, inject, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
  IonBadge, IonFab, IonFabButton, IonIcon, IonModal, IonButton, IonButtons,
  IonInput, IonSelect, IonSelectOption, IonTextarea,
  IonItemSliding, IonItemOptions, IonItemOption, IonNote,
  IonSearchbar, IonSegment, IonSegmentButton,
  IonListHeader, IonChip, IonProgressBar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, trashOutline, checkmarkOutline, settingsOutline, createOutline,
  refreshOutline, listOutline, layersOutline, calendarOutline,
  fastFoodOutline, carOutline, flashOutline, homeOutline, filmOutline,
  medkitOutline, cartOutline, giftOutline, ellipsisHorizontalOutline,
  pricetagOutline, repeatOutline, colorPaletteOutline, closeOutline,
  chevronBackOutline, chevronForwardOutline, todayOutline,
} from 'ionicons/icons';
import { Router } from '@angular/router';
import { Subject, combineLatest, BehaviorSubject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { CategoryService } from '../../core/services/category.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { CreditCardService } from '../../core/services/credit-card.service';
import { WalletService } from '../../core/services/wallet.service';
import {
  Expense,
  PaymentStatus,
  Income,
  Category,
  WalletAccount,
  PendingNotificationCandidate,
} from '../../core/models';
import { PayModalComponent, PayModalResult } from '../shared/pay-modal/pay-modal.component';
import { PendingNotificationQueueService } from '../../core/services/pending-notification-queue.service';

export type PeriodFilter = 'month' | 'year' | 'all';

/** Expense extended with a preview flag for future-month recurring forecasts */
export interface ExpenseDisplay extends Expense {
  isPreview?: boolean;
}

export interface ExpenseGroup {
  category: string;
  icon: string;
  color: string;
  expenses: ExpenseDisplay[];
  total: number;
  previewTotal: number;
  budget?: number;
  budgetPercent?: number;
}

const METHODS = ['Cash', 'GCash', 'Credit Card', 'Debit Card', 'Bank Transfer'];

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [
    AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
    IonBadge, IonFab, IonFabButton, IonIcon, IonModal, IonButton, IonButtons,
    IonInput, IonSelect, IonSelectOption, IonTextarea,
    IonItemSliding, IonItemOptions, IonItemOption, IonNote,
    IonSearchbar, IonSegment, IonSegmentButton,
    IonListHeader, IonChip, IonProgressBar,
    PayModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './expenses.component.html',
})
export class ExpensesComponent implements OnInit, OnDestroy {
  private engine = inject(FinancialEngineService);
  private prefs = inject(PreferencesService);
  private router = inject(Router);
  categoryService = inject(CategoryService);
  private quickAdd = inject(QuickAddService);
  creditCardService = inject(CreditCardService);
  walletService = inject(WalletService);
  readonly pendingQueue = inject(PendingNotificationQueueService);

  // ── UI state ─────────────────────────────────────────────────────────
  isModalOpen = false;
  isPayModalOpen = false;
  isCategoryModalOpen = false;
  payingExpense: Expense | null = null;
  editingExpense: Expense | null = null;
  editingCategory: Category | null = null;
  paidAtForm = '';
  recordingCandidate: PendingNotificationCandidate | null = null;
  /** Route the candidate review was opened from; the user returns there when it closes. */
  private reviewReturnUrl: string | null = null;
  /** How the reviewed notification is recorded; null until the user chooses for ambiguous ones. */
  recordingType: 'expense' | 'transfer' | null = null;
  transferDirection: 'out' | 'in' | null = null;
  isSavingExpense = false;
  saveError = '';
  /** Candidate whose transfer was already written; a retry only re-marks it, never writes again. */
  private recordedTransferCandidateId: string | null = null;
  notificationReviewError = '';

  // ── Filters ──────────────────────────────────────────────────────────
  searchText$ = new BehaviorSubject<string>('');
  period$ = new BehaviorSubject<PeriodFilter>('month');
  categoryFilter$ = new BehaviorSubject<string>('');
  selectedMonth$ = new BehaviorSubject<{ year: number; month: number }>(
    { year: new Date().getFullYear(), month: new Date().getMonth() }
  );
  selectedYear$ = new BehaviorSubject<number>(new Date().getFullYear());

  // ── Derived grouped list ──────────────────────────────────────────────
  groups$ = combineLatest([
    this.engine.getExpenses(),
    this.categoryService.getCategories(),
    this.searchText$,
    this.period$,
    this.categoryFilter$,
    this.selectedMonth$,
    this.selectedYear$,
  ]).pipe(
    map(([expenses, cats, search, period, catFilter, selMonth, selYear]) => {
      const now = new Date();

      // Is the selected view a future month?
      const isFutureMonth =
        period === 'month' &&
        (selMonth.year > now.getFullYear() ||
          (selMonth.year === now.getFullYear() && selMonth.month > now.getMonth()));

      let filtered: ExpenseDisplay[] = expenses.filter(e => {
        const d = new Date(e.date);
        if (period === 'month') {
          return d.getFullYear() === selMonth.year && d.getMonth() === selMonth.month;
        }
        if (period === 'year') return d.getFullYear() === selYear;
        return true;
      });

      // ── Inject recurring previews for future months ──────────────────
      if (isFutureMonth) {
        // Take the most-recent occurrence of each unique recurring expense
        const recurringByKey = new Map<string, Expense>();
        for (const e of [...expenses].filter(x => x.recurring).sort((a, b) => b.date.localeCompare(a.date))) {
          const key = `${e.category}||${e.name || ''}`;
          if (!recurringByKey.has(key)) recurringByKey.set(key, e);
        }

        // Only add previews not already present as real entries this month
        const realKeys = new Set(filtered.map(e => `${e.category}||${e.name || ''}`));
        for (const [key, e] of recurringByKey) {
          if (realKeys.has(key)) continue;
          // Keep the original day-of-month, capped to last day of target month
          const origDay = new Date(e.date).getDate();
          const lastDay = new Date(selMonth.year, selMonth.month + 1, 0).getDate();
          const day = Math.min(origDay, lastDay);
          const projectedDate = `${selMonth.year}-${String(selMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          filtered.push({ ...e, id: `preview_${e.id}`, date: projectedDate, status: 'pending', isPreview: true });
        }
      }
      if (catFilter) filtered = filtered.filter(e => e.category === catFilter);
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(e =>
          (e.name || '').toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes || '').toLowerCase().includes(q)
        );
      }
      filtered = [...filtered].sort((a, b) => {
        if (a.isPreview && !b.isPreview) return 1;
        if (!a.isPreview && b.isPreview) return -1;
        return b.date.localeCompare(a.date);
      });
      const groupMap = new Map<string, ExpenseDisplay[]>();
      filtered.forEach(e => {
        const list = groupMap.get(e.category) ?? [];
        list.push(e);
        groupMap.set(e.category, list);
      });
      return [...groupMap.entries()]
        .map(([catName, items]): ExpenseGroup => {
          const cat = cats.find(c => c.name === catName);
          const realItems = items.filter(i => !i.isPreview);
          const total = realItems.reduce((s, x) => s + x.amount, 0);
          const previewTotal = items.filter(i => i.isPreview).reduce((s, x) => s + x.amount, 0);
          const budget = cat?.budget;
          const budgetPercent = budget && budget > 0 ? Math.min(100, (total / budget) * 100) : undefined;
          return {
            category: catName,
            icon: cat?.icon ?? 'pricetag-outline',
            color: cat?.color ?? '#94a3b8',
            expenses: items,
            total,
            previewTotal,
            budget,
            budgetPercent,
          };
        })
        .sort((a, b) => a.category.localeCompare(b.category));
    })
  );

  categories$ = this.categoryService.getCategories();
  cards$ = this.creditCardService.getCards();
  methods = METHODS;
  userName = 'U';
  userInitial = 'U';
  get currencyCode(): string {
    return this.prefs.currentCurrencyCode;
  }

  form: Partial<Expense> = this.blankForm();
  categoryForm: Partial<Category> = this.blankCategoryForm();

  readonly iconOptions = [
    'fast-food-outline', 'car-outline', 'flash-outline', 'home-outline',
    'film-outline', 'medkit-outline', 'cart-outline', 'gift-outline',
    'ellipsis-horizontal-outline', 'pricetag-outline', 'repeat-outline',
    'color-palette-outline', 'calendar-outline', 'layers-outline',
  ];
  readonly colorSwatches = [
    '#4ade80', '#facc15', '#f97316', '#ec4899', '#3b82f6',
    '#14b8a6', '#c084fc', '#a78bfa', '#94a3b8', '#f87171',
    '#38bdf8', '#fb923c', '#a3e635', '#e879f9',
  ];

  private destroy$ = new Subject<void>();

  constructor() {
    addIcons({
      addOutline, trashOutline, checkmarkOutline, settingsOutline, createOutline,
      refreshOutline, listOutline, layersOutline, calendarOutline,
      fastFoodOutline, carOutline, flashOutline, homeOutline, filmOutline,
      medkitOutline, cartOutline, giftOutline, ellipsisHorizontalOutline,
      pricetagOutline, repeatOutline, colorPaletteOutline, closeOutline,
      chevronBackOutline, chevronForwardOutline, todayOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.userInitial = this.prefs.getUserInitial(this.userName);
    await this.openRequestedWalletCandidate();
    // Open add-expense modal when Quick-Log FAB is tapped from Dashboard
    this.quickAdd.onTrigger$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      setTimeout(() => this.openModal(), 120);
    });
  }

  ionViewWillEnter(): void {
    void this.openRequestedWalletCandidate();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Filter helpers ────────────────────────────────────────────────────
  get searchText(): string { return this.searchText$.value; }
  set searchText(v: string) { this.searchText$.next(v); }

  get period(): PeriodFilter { return this.period$.value; }
  set period(v: PeriodFilter) { this.period$.next(v as PeriodFilter); }

  get categoryFilter(): string { return this.categoryFilter$.value; }
  set categoryFilter(v: string) { this.categoryFilter$.next(v); }

  get selectedMonth(): { year: number; month: number } { return this.selectedMonth$.value; }
  get selectedYear(): number { return this.selectedYear$.value; }

  readonly MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  get selectedMonthLabel(): string {
    return `${this.MONTH_NAMES[this.selectedMonth.month]} ${this.selectedMonth.year}`;
  }

  get isCurrentMonth(): boolean {
    const now = new Date();
    return this.selectedMonth.year === now.getFullYear() && this.selectedMonth.month === now.getMonth();
  }

  get isCurrentYear(): boolean {
    return this.selectedYear === new Date().getFullYear();
  }

  prevMonth(): void {
    const { year, month } = this.selectedMonth$.value;
    const d = new Date(year, month - 1);
    this.selectedMonth$.next({ year: d.getFullYear(), month: d.getMonth() });
  }

  nextMonth(): void {
    const { year, month } = this.selectedMonth$.value;
    const d = new Date(year, month + 1);
    this.selectedMonth$.next({ year: d.getFullYear(), month: d.getMonth() });
  }

  goToCurrentMonth(): void {
    this.selectedMonth$.next({ year: new Date().getFullYear(), month: new Date().getMonth() });
  }

  prevYear(): void {
    this.selectedYear$.next(this.selectedYear$.value - 1);
  }

  nextYear(): void {
    this.selectedYear$.next(this.selectedYear$.value + 1);
  }

  goToCurrentYear(): void {
    this.selectedYear$.next(new Date().getFullYear());
  }

  // ── Expense CRUD ──────────────────────────────────────────────────────
  goToSettings(): void { this.router.navigate(['/settings']); }

  openModal(): void {
    this.editingExpense = null;
    this.recordingCandidate = null;
    this.saveError = '';
    this.form = this.blankForm();
    this.isModalOpen = true;
  }

  openEditExpense(expense: Expense): void {
    this.editingExpense = expense;
    this.recordingCandidate = null;
    this.saveError = '';
    this.form = { ...expense };
    this.paidAtForm = expense.paidAt ?? '';
    this.isModalOpen = true;
  }

  closeModal(): void {
    const returnUrl = this.reviewReturnUrl;
    this.reviewReturnUrl = null;
    if (this.recordingCandidate) this.pendingQueue.notifyExpenseReviewFinished();
    this.isModalOpen = false;
    this.editingExpense = null;
    this.recordingCandidate = null;
    this.recordingType = null;
    this.transferDirection = null;
    this.recordedTransferCandidateId = null;
    this.paidAtForm = '';
    this.saveError = '';
    if (returnUrl) void this.router.navigateByUrl(returnUrl);
  }

  /** Blocks saving until a reviewed notification has its type and the fields that type needs. */
  isSaveDisabled(): boolean {
    if (this.recordingCandidate && !this.recordingType) return true;
    if (this.recordingCandidate && this.recordingType === 'transfer') {
      return !this.transferDirection || !this.form.accountId || !this.form.amount || !this.form.date;
    }
    return !this.form.category || !this.form.amount || !this.form.date;
  }

  async save(): Promise<void> {
    const amount = Number(this.form.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !this.form.date) return;
    if (this.isSavingExpense) return;
    if (
      this.recordingCandidate &&
      !this.pendingQueue.pendingCandidates().some(candidate => candidate.id === this.recordingCandidate?.id)
    ) {
      this.saveError = 'This notification is no longer pending review. Close this form and refresh the list.';
      return;
    }
    if (this.recordingCandidate && this.recordingType === 'transfer') {
      await this.saveRecordedTransfer(amount);
      return;
    }
    if (this.recordingCandidate && !this.recordingType) return;
    if (!this.form.category) return;
    const isCreditCard = this.form.paymentMethod === 'Credit Card';
    const base = {
      name: this.form.name || '',
      category: this.form.category!,
      amount,
      date: this.form.date!,
      paymentMethod: this.form.paymentMethod || 'Cash',
      accountId: this.form.paymentMethod === 'Credit Card' ? undefined : this.form.accountId || undefined,
      creditCardId: isCreditCard ? (this.form.creditCardId || undefined) : undefined,
      notes: this.form.notes || '',
      recurring: this.form.recurring ?? false,
    };
    this.isSavingExpense = true;
    this.saveError = '';
    try {
      if (this.editingExpense) {
        const paidAt = this.editingExpense.status === 'paid'
          ? (this.paidAtForm || this.editingExpense.paidAt)
          : this.editingExpense.paidAt;
        await this.engine.updateExpense({ ...this.editingExpense, ...base, paidAt });
      } else {
        await this.engine.addExpense({
          ...base,
          status: 'pending',
          ...(this.recordingCandidate
            ? { sourceNotificationFingerprint: this.recordingCandidate.fingerprint }
            : {}),
        });
      }
      if (this.recordingCandidate) {
        await this.pendingQueue.markImported(this.recordingCandidate.id);
      }
      this.closeModal();
    } catch (error) {
      this.saveError =
        error instanceof Error ? error.message : 'Could not save this expense. The notification is still pending.';
    } finally {
      this.isSavingExpense = false;
    }
  }

  /**
   * Records a reviewed transfer as a one-sided change to the chosen account.
   * The candidate is marked imported after the balance change; a failure after that point
   * is reported so the user does not record it twice.
   */
  private async saveRecordedTransfer(amount: number): Promise<void> {
    const candidate = this.recordingCandidate!;
    if (
      !this.transferDirection ||
      !this.form.accountId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !this.form.date
    ) {
      return;
    }
    if (this.isSavingExpense) return;
    if (!this.pendingQueue.pendingCandidates().some(item => item.id === candidate.id)) {
      this.saveError = 'This notification is no longer pending review. Close this form and refresh the list.';
      return;
    }
    this.isSavingExpense = true;
    this.saveError = '';
    const alreadyRecorded = this.recordedTransferCandidateId === candidate.id;
    try {
      if (!alreadyRecorded) {
        await this.walletService.recordExternalTransfer(
          this.form.accountId,
          this.transferDirection,
          amount,
          this.form.date,
          this.form.name || candidate.merchantName || ''
        );
        this.recordedTransferCandidateId = candidate.id;
      }
      await this.pendingQueue.markImported(candidate.id);
      this.closeModal();
    } catch (error) {
      this.saveError = this.recordedTransferCandidateId === candidate.id
        ? 'The transfer was recorded, but the notification could not be updated. Press Save again to retry the update only.'
        : error instanceof Error
          ? error.message
          : 'Could not record this transfer. The notification is still pending.';
    } finally {
      this.isSavingExpense = false;
    }
  }

  /** Ignores the notification without creating or changing any expense, income, or balance. */
  async skipRecording(): Promise<void> {
    const candidate = this.recordingCandidate;
    if (!candidate || this.isSavingExpense) return;
    this.isSavingExpense = true;
    try {
      await this.pendingQueue.skip(candidate.id);
      this.closeModal();
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'Could not skip this notification.';
    } finally {
      this.isSavingExpense = false;
    }
  }

  recordCandidate(candidate: PendingNotificationCandidate): void {
    this.recordingCandidate = candidate;
    this.editingExpense = null;
    this.saveError = '';
    // Candidates saved before classification existed have no transactionType; they were all expenses.
    this.recordingType =
      candidate.transactionType === 'transfer'
        ? 'transfer'
        : candidate.transactionType === undefined ||
            candidate.transactionType === 'payment' ||
            candidate.transactionType === 'fee'
          ? 'expense'
          : null;
    this.transferDirection =
      candidate.direction === 'outgoing' ? 'out' : candidate.direction === 'incoming' ? 'in' : null;
    const appCurrency = this.currencyCode.toUpperCase();
    const candidateCurrency = candidate.currency?.toUpperCase() ?? null;
    this.form = {
      name: candidate.merchantName ?? '',
      category: '',
      amount: candidate.amount !== null && candidateCurrency === appCurrency
        ? candidate.amount
        : undefined,
      date: this.inputDate(candidate.transactionTimestamp ?? candidate.notificationTimestamp),
      paymentMethod: candidate.cardLabel || candidate.cardSuffix ? 'Credit Card' : 'Cash',
      creditCardId: undefined,
      notes: '',
      recurring: false,
    };
    this.isModalOpen = true;
  }

  private async openRequestedWalletCandidate(): Promise<void> {
    const candidateId = this.pendingQueue.takeExpenseReviewRequest();
    const returnUrl = this.pendingQueue.takeExpenseReviewReturnUrl();
    if (!candidateId) return;
    this.reviewReturnUrl = returnUrl;
    this.notificationReviewError = '';
    try {
      await this.pendingQueue.ready();
      const candidate = this.pendingQueue
        .pendingCandidates()
        .find(item => item.id === candidateId);
      if (candidate) {
        this.recordCandidate(candidate);
      } else {
        this.notificationReviewError = 'This notification is no longer pending review.';
        this.pendingQueue.notifyExpenseReviewFinished();
      }
    } catch (error) {
      this.notificationReviewError =
        error instanceof Error ? error.message : 'Could not load the pending notification.';
      this.pendingQueue.notifyExpenseReviewFinished();
    }
  }

  private inputDate(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  onPaymentPickerChange(value: string): void {
    if (value?.startsWith('account:')) {
      const accountId = value.slice('account:'.length);
      const account = this.walletService.getAccount(accountId);
      this.form.accountId = accountId;
      this.form.paymentMethod = account?.name ?? 'Cash';
      this.form.creditCardId = undefined;
      return;
    }
    const method = value?.startsWith('method:') ? value.slice('method:'.length) : 'Cash';
    this.form.accountId = undefined;
    this.form.paymentMethod = method;
    if (method !== 'Credit Card') this.form.creditCardId = undefined;
  }

  get paymentPickerValue(): string {
    const linked = this.form.accountId ? this.walletService.getAccount(this.form.accountId) : undefined;
    if (linked && this.isAccountSelectable(linked)) return 'account:' + linked.id;
    return 'method:' + (this.form.paymentMethod || 'Cash');
  }

  selectableAccounts(): WalletAccount[] {
    return this.walletService.accounts().filter(account => this.isAccountSelectable(account));
  }

  /** Legacy payment methods without a matching active account. GCash is only offered as an account. */
  untrackedMethods(): string[] {
    const accountNames = new Set(this.selectableAccounts().map(a => a.name.toLowerCase()));
    return this.methods.filter(m =>
      m !== 'GCash' && !accountNames.has(m.toLowerCase())
    );
  }

  accountName(id?: string): string {
    if (!id) return '';
    return this.walletService.getAccount(id)?.name ?? 'Archived account';
  }

  isAccountSelectable(account: WalletAccount): boolean {
    return account.currency === this.currencyCode && !account.isArchived;
  }

  async markPaid(e: Expense): Promise<void> {
    this.payingExpense = e;
    this.isPayModalOpen = true;
  }

  async markUnpaid(e: Expense): Promise<void> {
    await this.engine.removeAllocationsForExpense(e.id);
    await this.engine.updateExpense({ ...e, status: 'pending', paidAt: undefined });
  }

  closePayModal(): void { this.isPayModalOpen = false; this.payingExpense = null; }

  async onPayResult(result: PayModalResult): Promise<void> {
    if (!this.payingExpense) return;
    if (result.withoutIncome) {
      await this.engine.updateExpense({ ...this.payingExpense, status: 'paid', paidAt: new Date().toISOString().split('T')[0] });
    } else {
      await this.engine.payExpenseWithIncomes(this.payingExpense, result.allocations);
    }
    this.closePayModal();
  }

  getExpenseIncomeSources(expenseId: string): string {
    const allocs = this.engine.getAllocationsForExpense(expenseId);
    if (!allocs.length) return '';
    const incomes: Income[] = [];
    this.engine.getIncomes().subscribe(list => incomes.push(...list)).unsubscribe();
    return allocs.map(a => {
      const inc = incomes.find(i => i.id === a.incomeId);
      return inc ? inc.source : 'Unknown';
    }).join(', ');
  }

  async delete(id: string): Promise<void> { await this.engine.deleteExpense(id); }

  badgeColor(status: PaymentStatus): string {
    return status === 'paid' ? 'success' : status === 'overdue' ? 'danger' : 'warning';
  }

  displayName(e: Expense): string {
    return e.name?.trim() ? e.name : e.category;
  }

  // ── Category management ───────────────────────────────────────────────
  openAddCategory(): void {
    this.editingCategory = null;
    this.categoryForm = this.blankCategoryForm();
    this.isCategoryModalOpen = true;
  }

  openEditCategory(cat: Category): void {
    this.editingCategory = cat;
    this.categoryForm = { ...cat };
    this.isCategoryModalOpen = true;
  }

  closeCategoryModal(): void { this.isCategoryModalOpen = false; this.editingCategory = null; }

  async saveCategory(): Promise<void> {
    if (!this.categoryForm.name?.trim()) return;
    const partial = {
      name: this.categoryForm.name!.trim(),
      icon: this.categoryForm.icon || 'pricetag-outline',
      color: this.categoryForm.color || '#94a3b8',
      budget: this.categoryForm.budget ? +this.categoryForm.budget : undefined,
    };
    if (this.editingCategory) {
      await this.categoryService.updateCategory({ ...this.editingCategory, ...partial });
    } else {
      await this.categoryService.addCategory(partial);
    }
    this.closeCategoryModal();
  }

  async deleteCategory(id: string): Promise<void> {
    await this.categoryService.deleteCategory(id);
  }

  private blankForm(): Partial<Expense> {
    return {
      name: '',
      category: '',
      amount: undefined,
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'Cash',
      creditCardId: undefined,
      notes: '',
      recurring: false,
    };
  }

  private blankCategoryForm(): Partial<Category> {
    return { name: '', icon: 'pricetag-outline', color: '#94a3b8', budget: undefined };
  }
}
