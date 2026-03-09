import { Component, OnInit, inject, OnDestroy } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
  IonBadge, IonFab, IonFabButton, IonIcon, IonModal, IonButton, IonButtons,
  IonInput, IonSelect, IonSelectOption, IonTextarea,
  IonItemSliding, IonItemOptions, IonItemOption, IonNote,
  IonSearchbar, IonSegment, IonSegmentButton, IonToggle,
  IonListHeader, IonChip, IonProgressBar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, trashOutline, checkmarkOutline, settingsOutline, createOutline,
  refreshOutline, listOutline, layersOutline, calendarOutline,
  fastFoodOutline, carOutline, flashOutline, homeOutline, filmOutline,
  medkitOutline, cartOutline, giftOutline, ellipsisHorizontalOutline,
  pricetagOutline, repeatOutline, colorPaletteOutline, closeOutline,
} from 'ionicons/icons';
import { Router } from '@angular/router';
import { Subject, combineLatest, BehaviorSubject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { FinancialEngineService } from '../../core/services/financial-engine.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { CategoryService } from '../../core/services/category.service';
import { QuickAddService } from '../../core/services/quick-add.service';
import { Expense, PaymentStatus, Income, Category } from '../../core/models';
import { PayModalComponent, PayModalResult } from '../shared/pay-modal/pay-modal.component';

export type PeriodFilter = 'month' | 'year' | 'all';

export interface ExpenseGroup {
  category: string;
  icon: string;
  color: string;
  expenses: Expense[];
  total: number;
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
    IonSearchbar, IonSegment, IonSegmentButton, IonToggle,
    IonListHeader, IonChip, IonProgressBar,
    PayModalComponent,
  ],
  templateUrl: './expenses.component.html',
})
export class ExpensesComponent implements OnInit, OnDestroy {
  private engine = inject(FinancialEngineService);
  private prefs = inject(PreferencesService);
  private router = inject(Router);
  categoryService = inject(CategoryService);
  private quickAdd = inject(QuickAddService);

  // ── UI state ─────────────────────────────────────────────────────────
  isModalOpen = false;
  isPayModalOpen = false;
  isCategoryModalOpen = false;
  payingExpense: Expense | null = null;
  editingExpense: Expense | null = null;
  editingCategory: Category | null = null;

  // ── Filters ──────────────────────────────────────────────────────────
  searchText$ = new BehaviorSubject<string>('');
  period$ = new BehaviorSubject<PeriodFilter>('month');
  categoryFilter$ = new BehaviorSubject<string>('');

  // ── Derived grouped list ──────────────────────────────────────────────
  groups$ = combineLatest([
    this.engine.getExpenses(),
    this.categoryService.getCategories(),
    this.searchText$,
    this.period$,
    this.categoryFilter$,
  ]).pipe(
    map(([expenses, cats, search, period, catFilter]) => {
      const now = new Date();
      let filtered = expenses.filter(e => {
        const d = new Date(e.date);
        if (period === 'month') {
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }
        if (period === 'year') return d.getFullYear() === now.getFullYear();
        return true;
      });
      if (catFilter) filtered = filtered.filter(e => e.category === catFilter);
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(e =>
          (e.name || '').toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes || '').toLowerCase().includes(q)
        );
      }
      filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
      const groupMap = new Map<string, Expense[]>();
      filtered.forEach(e => {
        const list = groupMap.get(e.category) ?? [];
        list.push(e);
        groupMap.set(e.category, list);
      });
      return [...groupMap.entries()]
        .map(([catName, items]): ExpenseGroup => {
          const cat = cats.find(c => c.name === catName);
          const total = items.reduce((s, x) => s + x.amount, 0);
          const budget = cat?.budget;
          const budgetPercent = budget && budget > 0 ? Math.min(100, (total / budget) * 100) : undefined;
          return {
            category: catName,
            icon: cat?.icon ?? 'pricetag-outline',
            color: cat?.color ?? '#94a3b8',
            expenses: items,
            total,
            budget,
            budgetPercent,
          };
        })
        .sort((a, b) => a.category.localeCompare(b.category));
    })
  );

  categories$ = this.categoryService.getCategories();
  methods = METHODS;
  userName = 'U';
  userInitial = 'U';
  currencyCode = 'PHP';

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
    });
  }

  async ngOnInit(): Promise<void> {
    this.userName = await this.prefs.getUserName();
    this.userInitial = this.prefs.getUserInitial(this.userName);
    this.currencyCode = this.prefs.currentCurrencyCode;

    // Open add-expense modal when Quick-Log FAB is tapped from Dashboard
    this.quickAdd.onTrigger$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      setTimeout(() => this.openModal(), 120);
    });
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

  // ── Expense CRUD ──────────────────────────────────────────────────────
  goToSettings(): void { this.router.navigate(['/settings']); }

  openModal(): void {
    this.editingExpense = null;
    this.form = this.blankForm();
    this.isModalOpen = true;
  }

  openEditExpense(expense: Expense): void {
    this.editingExpense = expense;
    this.form = { ...expense };
    this.isModalOpen = true;
  }

  closeModal(): void { this.isModalOpen = false; this.editingExpense = null; }

  async save(): Promise<void> {
    if (!this.form.category || !this.form.amount || !this.form.date) return;
    const base = {
      name: this.form.name || '',
      category: this.form.category!,
      amount: +this.form.amount!,
      date: this.form.date!,
      paymentMethod: this.form.paymentMethod || 'Cash',
      notes: this.form.notes || '',
      recurring: this.form.recurring ?? false,
    };
    if (this.editingExpense) {
      await this.engine.updateExpense({ ...this.editingExpense, ...base });
    } else {
      await this.engine.addExpense({ ...base, status: 'pending' });
    }
    this.closeModal();
  }

  async markPaid(e: Expense): Promise<void> {
    this.payingExpense = e;
    this.isPayModalOpen = true;
  }

  closePayModal(): void { this.isPayModalOpen = false; this.payingExpense = null; }

  async onPayResult(result: PayModalResult): Promise<void> {
    if (!this.payingExpense) return;
    if (result.withoutIncome) {
      await this.engine.updateExpense({ ...this.payingExpense, status: 'paid' });
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
      notes: '',
      recurring: false,
    };
  }

  private blankCategoryForm(): Partial<Category> {
    return { name: '', icon: 'pricetag-outline', color: '#94a3b8', budget: undefined };
  }
}
