export type PaymentStatus = 'pending' | 'paid' | 'overdue';

export interface Category {
  id: string;
  name: string;
  icon: string;   // Ionicons icon name, e.g. 'fast-food-outline'
  color: string;  // hex color string, e.g. '#4ade80'
  budget?: number; // optional monthly budget limit
}

export interface SavingsGoal {
  id: string;
  name: string;
  icon: string;        // Ionicons icon name
  color: string;       // hex color
  targetAmount: number;
  currentAmount: number;
  deadline?: string;   // ISO date string (optional target date)
  notes?: string;
}

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
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

export interface Expense {
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

export interface Income {
  id: string;
  name?: string;    // optional display label, e.g. "March Salary"
  source: string;
  amount: number;
  date: string;
  recurring: boolean;
}

export interface CreditCard {
  id: string;
  bank: string;
  name: string;
  dueDate: number; // day of month
  cutoffDate: number; // day of month
  creditLimit: number;
}

export interface Installment {
  id: string;
  cardId: string;
  transaction: string;
  monthlyAmount: number;
  startDate: string; // ISO date string
  months: number;
  frequency?: 'monthly' | 'weekly'; // defaults to 'monthly' when absent
}

export interface InstallmentPayment {
  id: string;
  installmentId: string;
  dueDate: string; // ISO date string
  amount: number;
  status: PaymentStatus;
  paidAt?: string; // YYYY-MM-DD date when marked as paid
}

export interface PaymentAllocation {
  id: string;
  incomeId: string;
  expenseId?: string;              // FK to Expense.id — set when paying an expense
  installmentPaymentId?: string;   // FK to InstallmentPayment.id — set when paying an installment
  amount: number;                  // portion of income allocated
}

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
