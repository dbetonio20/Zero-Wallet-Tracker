# 🚀 Zero Wallet Tracker — GitHub Skill / Engineering Guide

## 📌 Overview

Zero Wallet Tracker is a mobile-first personal finance app built with Angular 21, Ionic 8, and Capacitor 8.

The app focuses on:

- Expense and income tracking
- Installments and credit card management
- Financial summaries and reports
- Offline-first local persistence
- Clean, reactive, strongly typed architecture
- Android-first delivery via Capacitor

This file is intended to help engineers and AI agents make changes that match the actual architecture of the project.

---

## 🧠 Core Engineering Principles

### 1. Clean code rules

Always preserve these rules:

- Single responsibility per component and service
- Strong typing only; never use `any`
- Clear separation of UI, business logic, and persistence
- Feature-based organization
- Immutable state updates
- Descriptive naming for methods, properties, and files

Good example:

```ts
readonly expenses = this._expenses.asReadonly();
readonly summary = computed(() => this.buildSummary());
```

Bad example:

```ts
getData(): any {
	return this.data;
}
```

### 2. Architecture pattern

Follow this flow:

```text
UI (Standalone Components)
	 ↓
Signals / Observable adapters
	 ↓
Services (Business Logic)
	 ↓
StorageService
	 ↓
IndexedDB via Ionic Storage
```

### 3. Reactive-first, but signal-first for state

Important: legacy docs may mention `BehaviorSubject` for app state. In this codebase, new state must use Angular Signals.

Use:

- `signal()` for writable state
- `computed()` for derived state
- `effect()` for coordinated reactions
- `toObservable()` when templates or consumers need Observables
- `Subject` / `Observable` only for true event streams or token streaming

Preferred pattern:

```ts
private readonly _expenses = signal<Expense[]>([]);
readonly expenses = this._expenses.asReadonly();
readonly expenses$ = toObservable(this._expenses);
readonly summary = computed(() => this.calculateSummary());
```

Never:

- Introduce new `BehaviorSubject`-based app state
- Mutate arrays in place
- Hide state changes inside components

---

## 🧩 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Angular 21 (standalone APIs only) |
| UI | Ionic 8 |
| Mobile | Capacitor 8 |
| Storage | `@ionic/storage-angular` with IndexedDB/localforage |
| Charts | chart.js + ng2-charts |
| Language | TypeScript 5.9 |
| Package Manager | Bun |
| Testing | Jasmine + Karma |

Additional implementation notes:

- Global Ionic mode is Material Design
- Android is the primary runtime target
- Local-first persistence is the default data model

---

## 📦 Key Dependencies

### Core

- `@angular/*`
- `rxjs`
- `zone.js`

### Mobile / Native

- `@capacitor/core`
- `@capacitor/android`
- `@capacitor/filesystem`
- `@capacitor/share`
- `@capacitor/local-notifications`

### UI

- `@ionic/angular/standalone`
- `@ionic/storage-angular`

### Data visualization

- `chart.js`
- `ng2-charts`

### AI / Native integration

- Custom Capacitor `LlmPlugin`

---

## 🏗️ Project Structure

```text
src/app/
	app.config.ts                 App-wide providers
	app.routes.ts                 Lazy-loaded route definitions
	core/
		models/                     Shared TypeScript interfaces
		plugins/                    Capacitor plugin wrappers
		services/                   Business logic and persistence orchestration
	features/
		ai/                         AI assistant feature
		dashboard/                  Main summary and income management
		debts/                      Credit cards and installments
		expenses/                   Expense CRUD and status handling
		income-detail/              Deep-linked income page
		login/                      Authentication UI
		reports/                    Charts and analytics
		settings/                   Preferences and data management
		tabs/                       Bottom tab shell
```

Rules:

- Keep business logic in `core/services`
- Keep UI in `features/*`
- Keep interfaces in `core/models/index.ts`
- Use kebab-case file names
- Do not add NgModules

---

## ⚙️ Coding Standards

### 1. Type safety is strict

- No `any`
- Use domain interfaces from `src/app/core/models/index.ts`
- Prefer explicit return types on public methods

Example:

```ts
interface Expense {
	id: string;
	amount: number;
}
```

### 2. Services own business logic

Services should handle:

- state
- derived calculations
- persistence
- domain rules
- scheduling or notification coordination

Services should not contain:

- template concerns
- DOM access
- component rendering logic

### 3. Components own UI

Components should handle:

- template rendering
- user interaction
- lightweight view-model composition
- routing/navigation concerns

Components should delegate business actions to services.

### 4. Storage pattern

All persistence must go through `StorageService`.

Do not write directly to Ionic Storage from feature components.

Preferred pattern:

```ts
await this.storage.saveList('expenses', expenses);
```

### 5. Immutable state updates

Good:

```ts
this._expenses.update((current) => [...current, expense]);
```

Bad:

```ts
current.push(expense);
```

---

## 📊 Financial Engine

The central business service is `FinancialEngineService`.

It is responsible for:

- expenses
- incomes
- installments
- installment payments
- payment allocations
- recurring item handling
- derived financial summary calculation
- overdue and pending status updates

Preferred derived state pattern:

```ts
readonly summary = computed(() => ({
	totalIncome: this.totalIncome(),
	totalExpenses: this.totalExpenses(),
	balance: this.balance()
}));
```

When changing finance logic, verify:

- `pending` / `paid` / `overdue` status transitions
- unpaid totals remain correct
- allocations still reconcile
- recurring generation is not duplicated

---

## 🧾 Core Domain Models

Primary models live in `src/app/core/models/index.ts`.

Important entities:

- `Expense`
- `Income`
- `CreditCard`
- `Installment`
- `InstallmentPayment`
- `PaymentAllocation`
- `SavingsGoal`
- `Category`
- `FinancialSummary`

Key relationship rules:

- `Expense.creditCardId` links to `CreditCard.id` when using credit card payments
- `Installment.cardId` links to `CreditCard.id`
- `InstallmentPayment.installmentId` links to `Installment.id`
- `PaymentAllocation` links income to either an expense or installment payment

---

## 📱 UI Guidelines

### Ionic + Angular rules

- Use standalone components only
- Prefer `ChangeDetectionStrategy.OnPush`
- Prefer `inject()` for dependency injection in components
- Use explicit `imports: []`
- Register every used Ionicon via `addIcons()` in the constructor

### Styling rules

Prefer:

- `.card-glass`
- `.page-header`
- Ionic color tokens
- CSS variables
- dark-mode-safe styling

Avoid:

- direct DOM manipulation
- random one-off overrides
- hardcoded light-theme colors
- unnecessary inline styles

### Performance rules

- Prefer async pipe or signal reads over manual subscriptions
- Use `trackBy` in repeated lists
- Keep template logic simple
- Extract non-trivial logic into component methods or computed state

---

## 🎨 Theme System

Theme behavior is controlled by `PreferencesService`.

Supported modes:

- `system`
- `dark`
- `light`

Dark mode is applied with the `ion-palette-dark` class.

Currency must always come from preferences, not hardcoded symbols.

Preferred template usage:

```html
{{ amount | currency: currencyCode : 'symbol' : '1.0-0' }}
```

---

## 📈 Reports System

Reports are built with Chart.js and ng2-charts.

Expected UI patterns:

- donut chart for category distribution
- custom legend UI
- calendar-style spend heatmap

Rules:

- keep charts compact and mobile-friendly
- avoid default legend clutter if a custom legend is available
- ensure color mappings stay consistent across categories

---

## 💳 Debt System

Debt management includes:

- credit cards
- installments
- installment payment schedules
- due and overdue tracking

Core pattern:

```text
Installment → generated InstallmentPayment[] → payment status tracking
```

When updating installment logic, ensure regenerated schedules do not leave stale payments behind.

---

## 🤖 AI Feature Rules

The AI assistant is powered by the native `LlmPlugin` wrapper, not browser-based Transformers.

Important rules:

- Android-only behavior is expected
- treat AI state as service-owned
- streamed tokens are valid Observable/Subject use cases
- AI context must remain compact and budgeted

When changing AI features, verify:

- model status flow
- download/init/generate/reset behavior
- token streaming UX
- prompt context size limits

Known product note:

- the AI route exists
- the bottom tab button may still need to be exposed in the tabs UI depending on the current branch state

---

## 🧪 Testing Strategy

Primary tools:

- Jasmine
- Karma

Highest-priority test targets:

- service logic
- financial calculations
- recurring generation
- overdue date logic
- allocation correctness

When adding logic, prefer tests around edge cases:

- month boundaries
- due-date rollovers
- already-paid items
- empty-state summaries

---

## ⚠️ Non-Negotiable Rules

### Must follow

- Use standalone components
- Lazy-load feature routes
- Use `provideRouter`
- Use Angular Signals for new state
- Keep persistence inside services
- Preserve strong typing

### Never do

- use `any`
- mutate state directly
- duplicate business logic
- put storage logic in components
- manipulate the DOM directly without a clear framework-supported reason
- introduce NgModules

---

## 🧱 Adding New Features

Use this order:

1. Add or extend model types
2. Extend an existing service or create a new service
3. Implement derived state and persistence
4. Create the feature UI under `features/`
5. Add lazy-loaded routing
6. Reuse established styling and interaction patterns
7. Validate with tests or targeted manual verification

Example flow for a new Budget feature:

1. Add `Budget` model
2. Create or extend a budget service
3. Persist via `StorageService`
4. Add `features/budget/`
5. Register route in `app.routes.ts`
6. Use existing cards, headers, and preference-driven currency formatting

---

## 🔐 Data Handling

- Data is stored locally in IndexedDB
- Export/import flows should remain JSON-friendly
- Offline-first behavior must not be broken
- Avoid introducing backend assumptions into core financial logic

---

## ✅ AI / Code Review Checklist

When reviewing or generating code for this repo, always check:

- correct use of signals versus event streams
- no state mutation
- no `any`
- proper separation of concerns
- correct financial status computation
- persistence routed through `StorageService`
- standalone component compliance
- icon registration for every used ion-icon
- dark-theme-safe UI changes

---

## 📌 Summary

This project enforces:

- clean architecture
- signal-first reactive state
- mobile-first design
- offline-first persistence
- modular scalability
- strict typing
- high-performance Angular patterns

If there is a conflict between older documentation and current implementation, prefer the current Angular 21 standalone + signal-first architecture used in the codebase.
