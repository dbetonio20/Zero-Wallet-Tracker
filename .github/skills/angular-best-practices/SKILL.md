# 🚀 Zero Wallet Tracker — Engineering Guide + Angular Skill

## 📌 Overview

Zero Wallet Tracker is a mobile-first personal finance app built with Angular 21, Ionic 8, and Capacitor 8.

The app focuses on:

* Expense and income tracking
* Installments and credit card management
* Financial summaries and reports
* Offline-first local persistence
* Clean, reactive, strongly typed architecture
* Android-first delivery via Capacitor

This document serves as both:

* 📘 Engineering Guide (project-specific rules)
* 🧠 Angular Best Practices Skill (for developers and AI agents)

---

# 🧠 Core Engineering Principles

## 1. Clean Code Rules

Always enforce:

* Single responsibility per component/service
* Strong typing (NO `any`)
* Separation of concerns (UI vs logic vs persistence)
* Feature-based structure
* Immutable updates
* Descriptive naming

### ✅ Good

```ts
readonly expenses = this._expenses.asReadonly();
readonly summary = computed(() => this.buildSummary());
```

### ❌ Bad

```ts
getData(): any {
  return this.data;
}
```

---

## 2. Architecture Pattern

```text
UI (Standalone Components)
   ↓
Signals / Observable adapters
   ↓
Services (Business Logic)
   ↓
StorageService
   ↓
IndexedDB (Ionic Storage)
```

---

## 3. Signal-First State Management

Use:

* `signal()` → writable state
* `computed()` → derived state
* `effect()` → side effects
* `toObservable()` → interop

### Standard Pattern

```ts
private readonly _expenses = signal<Expense[]>([]);

readonly expenses = this._expenses.asReadonly();
readonly expenses$ = toObservable(this._expenses);

readonly summary = computed(() => this.calculateSummary());
```

### ❌ Never

* Use `BehaviorSubject` for app state
* Mutate arrays directly
* Hide state inside components

---

# 🧩 Tech Stack

| Layer           | Technology                   |
| --------------- | ---------------------------- |
| Framework       | Angular 21 (standalone only) |
| UI              | Ionic 8                      |
| Mobile          | Capacitor 8                  |
| Storage         | Ionic Storage (IndexedDB)    |
| Charts          | chart.js + ng2-charts        |
| Language        | TypeScript 5.9               |
| Testing         | Jasmine + Karma              |
| Package Manager | Bun                          |

---

# 🏗️ Project Structure

```text
src/app/
  core/
    models/
    services/
    plugins/
  features/
    ai/
    dashboard/
    debts/
    expenses/
    reports/
    settings/
    tabs/
```

### Rules

* Business logic → `core/services`
* UI → `features/*`
* Models → `core/models`
* No NgModules
* Kebab-case filenames

---

# ⚙️ Coding Standards

## Type Safety

```ts
interface Expense {
  id: string;
  amount: number;
}
```

✔ No `any`
✔ Explicit return types

---

## Services Own Logic

Services handle:

* state
* calculations
* persistence
* domain rules

Components should NEVER:

* access storage directly
* contain business logic

---

## Immutable Updates

```ts
this._expenses.update(curr => [...curr, expense]);
```

---

## Storage Pattern

```ts
await this.storage.saveList('expenses', expenses);
```

✔ Always go through `StorageService`

---

# 📊 Financial Engine

Central service: `FinancialEngineService`

Handles:

* expenses
* incomes
* installments
* allocations
* recurring logic
* summaries

### Derived State Pattern

```ts
readonly summary = computed(() => ({
  totalIncome: this.totalIncome(),
  totalExpenses: this.totalExpenses(),
  balance: this.balance()
}));
```

---

# 📱 Angular Best Practices Skill

## 1. Standalone Components (MANDATORY)

```ts
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, CurrencyPipe],
})
export class MyComponent {
  private readonly service = inject(MyService);

  constructor() {
    addIcons({ addOutline });
  }
}
```

### Checklist

* [ ] standalone: true
* [ ] OnPush
* [ ] explicit imports[]
* [ ] inject() usage
* [ ] addIcons() in constructor

---

## 2. Signal-Based Services

```ts
@Injectable({ providedIn: 'root' })
export class MyService {
  private readonly _items = signal<Item[]>([]);

  readonly items = this._items.asReadonly();
  readonly items$ = toObservable(this._items);

  readonly total = computed(() =>
    this._items().reduce((sum, i) => sum + i.amount, 0)
  );
}
```

---

## 3. CRUD Service Pattern

```ts
async add(item: Omit<MyItem, 'id'>): Promise<void> {
  const withId = { ...item, id: crypto.randomUUID() };
  const updated = [...this._items(), withId];

  await this.storage.saveList(STORAGE_KEY, updated);
  this._items.set(updated);
}
```

---

## 4. Template Patterns

### Signals

```html
{{ myService.total() }}
```

### ViewModel

```html
@if (vm$ | async; as vm) {
  {{ vm.balance | currency:vm.currencyCode }}
}
```

---

## 5. Naming Conventions

| Type       | Example                   |
| ---------- | ------------------------- |
| File       | expense-list.component.ts |
| Service    | ExpenseService            |
| Signal     | _expenses                 |
| Observable | expenses$                 |
| Computed   | total                     |

---

## 6. Clean Code Rules

### ❌ No `any`

### ❌ No logic in templates

```ts
readonly paidCount = computed(() =>
  this._items().filter(x => x.status === 'paid').length
);
```

---

# 🎨 UI Guidelines

* Ionic standalone components only
* OnPush always
* No direct DOM manipulation
* Dark-mode safe styling
* Use Ionic tokens

---

# 📈 Reports System

* Chart.js + ng2-charts
* Donut charts
* Custom legends
* Mobile-first design

---

# 💳 Debt System

```text
Installment → InstallmentPayment[] → Status tracking
```

✔ Ensure no duplicate schedules
✔ Maintain correct payment states

---

# 🤖 AI Feature Rules

* Uses native `LlmPlugin`
* Android-first
* Streaming uses Observables
* Keep prompt context small

---

# 🧪 Testing Strategy

Focus on:

* financial calculations
* recurring logic
* overdue handling
* allocations

---

# ⚠️ Non-Negotiable Rules

## MUST

* Signals for state
* Standalone components
* Lazy routes
* Strong typing
* Storage via service

## NEVER

* `any`
* NgModules
* direct mutation
* storage in components
* duplicate logic

---

# 🧱 Adding Features

1. Add model
2. Extend service
3. Add persistence
4. Build UI
5. Add route
6. Reuse patterns
7. Validate

---

# 🔐 Data Handling

* IndexedDB only
* JSON export/import
* Offline-first

---

# ✅ Code Review Checklist

* [ ] No `any`
* [ ] Signals used correctly
* [ ] No mutation
* [ ] Clean separation of concerns
* [ ] Storage via service
* [ ] OnPush components
* [ ] Icons registered
* [ ] Currency dynamic
* [ ] No template logic

---

# 📌 Final Summary

This project enforces:

* Signal-first Angular architecture
* Clean separation of concerns
* Offline-first design
* Strong typing
* High performance patterns

👉 When in doubt:
**Follow Angular 21 standalone + signal-first approach — always over legacy patterns.**
