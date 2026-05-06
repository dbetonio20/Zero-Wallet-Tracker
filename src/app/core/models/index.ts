export type PaymentStatus = 'pending' | 'paid' | 'overdue';

export interface SyncMetadata {
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt: string | null;
  deletedAt: string | null;
}

export type SyncMetadataField = keyof SyncMetadata;

export interface SyncWarning {
  code:
    | 'missing-server-updated-at'
    | 'missing-updated-at'
    | 'missing-deleted-at'
    | 'normalized-legacy-record'
    | 'best-effort-skip';
  entityType: string;
  recordId?: string;
  message: string;
}

export interface SyncImportIssue {
  code:
    | 'invalid-json'
    | 'invalid-entity-shape'
    | 'duplicate-id'
    | 'invalid-timestamp'
    | 'broken-reference'
    | 'conflict-blocked';
  entityType: string;
  recordId?: string;
  message: string;
}

export interface ImportReport {
  mode: 'strict' | 'best-effort';
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  warnings: SyncWarning[];
  issues: SyncImportIssue[];
}

export interface UserPreferences extends SyncMetadata {
  id: 'preferences';
  userName: string;
  theme: string;
  currencySymbol: string;
  currencyCode: string;
  palette: string;
}

export interface Category extends SyncMetadata {
  id: string;
  name: string;
  icon: string;   // Ionicons icon name, e.g. 'fast-food-outline'
  color: string;  // hex color string, e.g. '#4ade80'
  budget?: number; // optional monthly budget limit
}

export interface SavingsGoal extends SyncMetadata {
  id: string;
  name: string;
  icon: string;        // Ionicons icon name
  color: string;       // hex color
  targetAmount: number;
  currentAmount: number;
  deadline?: string;   // ISO date string (optional target date)
  notes?: string;
}

export type NewSyncedEntityInput<T extends { id: string } & SyncMetadata> = Omit<
  T,
  'id' | SyncMetadataField
>;

export type NewCategoryInput = NewSyncedEntityInput<Category>;
export type NewSavingsGoalInput = Omit<NewSyncedEntityInput<SavingsGoal>, 'currentAmount'>;

export const DEFAULT_CATEGORIES: NewCategoryInput[] = [
  { name: 'Food',          icon: 'fast-food-outline',     color: '#4ade80' },
  { name: 'Transport',     icon: 'car-outline',           color: '#facc15' },
  { name: 'Utilities',     icon: 'flash-outline',         color: '#f97316' },
  { name: 'Rent',          icon: 'home-outline',          color: '#ec4899' },
  { name: 'Entertainment', icon: 'film-outline',          color: '#3b82f6' },
  { name: 'Health',        icon: 'medkit-outline',        color: '#14b8a6' },
  { name: 'Shopping',      icon: 'cart-outline',          color: '#c084fc' },
  { name: 'Gifts',         icon: 'gift-outline',          color: '#a78bfa' },
  { name: 'Other',         icon: 'ellipsis-horizontal-outline', color: '#94a3b8' },
];

export interface Expense extends SyncMetadata {
  id: string;
  name: string;       // free-text title, e.g. "PLDT bill", "Jollibee lunch"
  category: string;
  amount: number;
  date: string; // ISO date string
  paymentMethod: string;
  creditCardId?: string; // set when paymentMethod is 'Credit Card'
  status: PaymentStatus;
  paidAt?: string; // YYYY-MM-DD date when marked as paid
  recurring: boolean; // marks a monthly repeating expense
  notes: string;
}

export type NewExpenseInput = NewSyncedEntityInput<Expense>;

export interface Income extends SyncMetadata {
  id: string;
  name?: string;    // optional display label, e.g. "March Salary"
  source: string;
  amount: number;
  date: string;
  recurring: boolean;
}

export type NewIncomeInput = NewSyncedEntityInput<Income>;

export interface CreditCard extends SyncMetadata {
  id: string;
  bank: string;
  name: string;
  dueDate: number; // day of month
  cutoffDate: number; // day of month
  creditLimit: number;
}

export type NewCreditCardInput = NewSyncedEntityInput<CreditCard>;

export interface Installment extends SyncMetadata {
  id: string;
  cardId: string;
  transaction: string;
  monthlyAmount: number;
  startDate: string; // ISO date string
  months: number;
  frequency?: 'monthly' | 'weekly'; // defaults to 'monthly' when absent
}

export type NewInstallmentInput = NewSyncedEntityInput<Installment>;

export interface InstallmentPayment extends SyncMetadata {
  id: string;
  installmentId: string;
  dueDate: string; // ISO date string
  amount: number;
  status: PaymentStatus;
  paidAt?: string; // YYYY-MM-DD date when marked as paid
}

export type NewInstallmentPaymentInput = NewSyncedEntityInput<InstallmentPayment>;

export interface PaymentAllocation extends SyncMetadata {
  id: string;
  incomeId: string;
  expenseId?: string;              // FK to Expense.id — set when paying an expense
  installmentPaymentId?: string;   // FK to InstallmentPayment.id — set when paying an installment
  amount: number;                  // portion of income allocated
}

export type NewPaymentAllocationInput = NewSyncedEntityInput<PaymentAllocation>;

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;       // sum of UNPAID (pending + overdue) expenses
  totalInstallments: number;   // sum of UNPAID installment payments
  totalCreditDues: number;
  totalObligations: number;    // totalExpenses + totalInstallments (all unpaid)
  paidExpenses: number;        // sum of paid expenses
  paidInstallments: number;    // sum of paid installment payments
  balance: number;             // totalIncome - totalExpenses - totalInstallments
  overdueAmount: number;
  upcomingAmount: number;
  allocatedIncome: number;     // sum of all payment allocation amounts
  availableIncome: number;     // totalIncome - allocatedIncome
}

export type SyncedEntity =
  | Category
  | CreditCard
  | Expense
  | Income
  | Installment
  | InstallmentPayment
  | PaymentAllocation
  | SavingsGoal
  | UserPreferences;

export function nowIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function createSyncMetadata(timestamp = nowIsoTimestamp()): SyncMetadata {
  return {
    createdAt: timestamp,
    updatedAt: timestamp,
    serverUpdatedAt: null,
    deletedAt: null,
  };
}

export function createSyncedEntity<T extends { id: string }>(
  entity: T,
  timestamp = nowIsoTimestamp()
): T & SyncMetadata {
  return {
    ...entity,
    ...createSyncMetadata(timestamp),
  };
}

export function normalizeSyncedEntity<T extends { id: string }>(
  entity: T & Partial<SyncMetadata>,
  fallbackTimestamp = nowIsoTimestamp()
): T & SyncMetadata {
  const createdAt = entity.createdAt ?? entity.updatedAt ?? fallbackTimestamp;
  const updatedAt = entity.updatedAt ?? createdAt;

  return {
    ...entity,
    createdAt,
    updatedAt,
    serverUpdatedAt: entity.serverUpdatedAt ?? null,
    deletedAt: entity.deletedAt ?? null,
  };
}

export function touchSyncedEntity<T extends SyncMetadata>(
  entity: T,
  timestamp = nowIsoTimestamp()
): T {
  return {
    ...entity,
    updatedAt: timestamp,
  };
}

export function tombstoneSyncedEntity<T extends SyncMetadata>(
  entity: T,
  timestamp = nowIsoTimestamp()
): T {
  return {
    ...entity,
    updatedAt: timestamp,
    deletedAt: timestamp,
  };
}

export function isSyncedEntityDeleted(entity: Pick<SyncMetadata, 'deletedAt'>): boolean {
  return entity.deletedAt !== null;
}

export function isActiveSyncedEntity<T extends Pick<SyncMetadata, 'deletedAt'>>(entity: T): boolean {
  return entity.deletedAt === null;
}

export function filterActiveSyncedEntities<T extends Pick<SyncMetadata, 'deletedAt'>>(
  entities: readonly T[]
): T[] {
  return entities.filter(isActiveSyncedEntity);
}
