# zero-wallet-tracker — Copilot Skills

A zero-based budgeting personal finance tracker for Android, built with Angular 21 + Ionic 8 + Capacitor 8.  
This file is the single authoritative reference for AI coding assistance on this project.

---

## 1. Tech Stack & Tooling

| Concern | Technology |
|---|---|
| Framework | **Angular 21** — standalone components only, no NgModules |
| UI library | **Ionic 8** (`@ionic/angular/standalone`), `mode: 'md'` forced globally |
| Charts | chart.js 4.5.1 + ng2-charts 10.0.0 |
| Storage | `@ionic/storage-angular` 4.0.0 — IndexedDB via localforage |
| Native layer | **Capacitor 8** — `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/local-notifications`, custom `LlmPlugin` |
| Package manager | **Bun** (use `bun` and `bun run`, never `npm` or `yarn`) |
| Language | TypeScript 5.9 — strict mode |
| Linting / Formatting | **Prettier**: `singleQuote: true`, `printWidth: 100`, `trailingComma: 'es5'` |
| Platform | Android only (Capacitor APK) |

---

## 2. Angular Best Practices for This Project

### Standalone-first (mandatory)
- Every component, directive, and pipe **must** be standalone (`standalone: true`).
- Never create or reference NgModules.
- Always declare explicit `imports: []` arrays — never rely on barrel re-exports.

### State management
- **All services use Angular Signals** (`signal()`, `computed()`, `effect()`) for state.
- **`Subject` / `Observable` only** for true push streams and one-shot events:
  - `QuickAddService` — `Subject<void>` event bus (not state)
  - `AiService.tokens$` / `debugLog$` — token streaming (not state)
  - `StorageService.ready$` — async init sequencing (internal only)
- Use `toObservable()` from `@angular/core/rxjs-interop` to expose signal state as Observables for templates using the `async` pipe.
- Use `toSignal()` to consume Observables from signals in new components.
- **Do not use `BehaviorSubject` for new state** — use `signal()` instead.

### Signal conventions in services
```ts
// Private writable signal
private readonly _items = signal<Item[]>([]);
// Public read-only signal — for direct reads or computed()
readonly items = this._items.asReadonly();
// Observable alias — for async pipe and combineLatest consumers
readonly items$ = toObservable(this._items);
// Derived state — replaces combineLatest + map
readonly summary = computed(() => computeSummary(this._items(), ...));
```

### Change detection
- Prefer `ChangeDetectionStrategy.OnPush` for all new components.
- Use the `async` pipe in templates instead of manual `.subscribe()`.
- When subscribing imperatorially, always clean up with `takeUntilDestroyed(this.destroyRef)`.

### Dependency injection
- Use `inject()` function in standalone contexts; constructor injection is fine in services.
- Services are `providedIn: 'root'` unless scoped to a feature.

### Routing
- All feature routes are **lazy-loaded** children under `TabsComponent`.
- Route file: `src/app/app.routes.ts`.

### General code quality
- No `any` types ever — define interfaces or use generics.
- JSDoc on all public service methods.
- Descriptive names — no single-letter variables outside of tight loops.
- Extract all non-trivial template logic into component methods or getters.
- File naming: `kebab-case.component.ts`, `kebab-case.service.ts`, `kebab-case.page.ts`.

---

## 3. Data Models

All interfaces live in `src/app/core/models/index.ts` — read that file for full field definitions.

| Model | Description |
|---|---|
| `PaymentStatus` | `'pending' \| 'paid' \| 'overdue'` |
| `Category` | `id, name, icon (Ionicons), color (hex), budget?` — seeded from `DEFAULT_CATEGORIES` (9 entries) on first run |
| `SavingsGoal` | `id, name, icon, color, targetAmount, currentAmount, deadline?, notes?` |
| `Expense` | `id, name, category, amount, date, paymentMethod, creditCardId?, status, recurring, notes` |
| `Income` | `id, source, amount, date, recurring` |
| `CreditCard` | `id, bank, name, dueDate (day-of-month), cutoffDate (day-of-month), creditLimit` |
| `Installment` | `id, cardId, transaction, monthlyAmount, startDate, months` |
| `InstallmentPayment` | `id, installmentId, dueDate, amount, status` |
| `PaymentAllocation` | `id, incomeId, expenseId?, installmentPaymentId?, amount` — links income to what it pays |
| `FinancialSummary` | Derived totals: `totalIncome, totalExpenses (unpaid), totalInstallments (unpaid), totalObligations, paidExpenses, paidInstallments, balance, overdueAmount, upcomingAmount, allocatedIncome, availableIncome` |

**Key FK relationships:**
- `Expense.creditCardId` → `CreditCard.id` (when `paymentMethod === 'Credit Card'`)
- `Installment.cardId` → `CreditCard.id`
- `InstallmentPayment.installmentId` → `Installment.id`
- `PaymentAllocation.expenseId` → `Expense.id` OR `PaymentAllocation.installmentPaymentId` → `InstallmentPayment.id`

---

## 4. Services

All services are in `src/app/core/services/`. All are `providedIn: 'root'`.

| Service | Purpose & key API |
|---|---|
| `StorageService` | Generic IndexedDB wrapper. **All persistence flows through here.** `getList<T>(key)`, `saveList<T>(key, items)`, `get<T>(key)`, `set(key, value)`. Wait for `ready$` before calling. |
| `FinancialEngineService` | **Central data hub.** Signals for each collection (`_expenses`, `_incomes`, etc.). `summary: Signal<FinancialSummary>` via `computed()`. `summary$: Observable` alias for async-pipe consumers. Full CRUD for expenses, incomes, installments, payments, allocations. Auto-generates recurring expense entries. Auto-updates overdue status. |
| `CreditCardService` | Credit card CRUD. `cards: Signal<CreditCard[]>` (read-only), `cards$: Observable`, `getCards()`, `getById(id)`, `getUpcomingDues(days)`. |
| `CategoryService` | Custom category CRUD. Seeds `DEFAULT_CATEGORIES` on first run. `categories: Signal<Category[]>`, `categories$: Observable`. Helper methods: `getColor(name)`, `getIcon(name)`. |
| `SavingsGoalService` | Goals CRUD. `goals: Signal<SavingsGoal[]>`, `goals$: Observable`. `contribute(id, amount)`, `withdraw(id, amount)`. |
| `PreferencesService` | User name, theme (`system \| dark \| light`), currency. `currencyCode: Signal<string>`, `currencySymbol: Signal<string>`, `currencyCode$`, `currencySymbol$`, `currentCurrencyCode` (sync getter). `exportAllData()`, `clearAllData()`. |
| `NotificationService` | Schedules `LocalNotifications` for expense due dates, installment payments, credit card due dates. |
| `QuickAddService` | Cross-component event bus — `Subject<void>` that triggers the quick-add FAB from anywhere. |
| `AiContextService` | Builds a budget-constrained (~3 200 chars) plain-text financial snapshot for the AI system prompt. Cascading section budgets in priority order. See `src/app/core/services/ai-context.service.ts`. |
| `AiService` | Wraps the native `LlmPlugin`. State signals: `aiState`, `modelProgress`, `lastError`, `inferenceDevice`. Observable aliases for backward compat. `tokens$: Observable<string>` for streamed output (Subject). `debugLog$: Observable<string>` for a debug panel (Subject). |

**Storage key constants** (defined in `FinancialEngineService`):

```ts
'expenses' | 'incomes' | 'installments' | 'installmentPayments' | 'paymentAllocations'
'credit_cards' | 'categories' | 'savingsGoals'
'pref_user_name' | 'pref_theme' | 'pref_currency_symbol' | 'pref_currency_code'
```

---

## 5. Features & Routes

All routes are lazy-loaded children of `TabsComponent` (`src/app/features/tabs/`).

| Route | Component | Tab bar |
|---|---|---|
| `/dashboard` | Dashboard — balance hero, overdue/upcoming alerts, income CRUD | Home (tab 1) |
| `/expenses` | Expense list — add/edit/delete/mark-paid, swipe actions | Expenses (tab 3) |
| `/reports` | Monthly analytics — donut chart by category + calendar heatmap | Reports (tab 2) |
| `/debts` | Segmented — installment schedules + credit card management | Debts (tab 4) |
| `/settings` | Theme, name, currency, export JSON, clear data | Gear icon |
| `/ai` | On-device AI financial assistant | ⚠️ Route exists but **tab button NOT yet added** to `TabsComponent` template |
| `/income/:id` | Income detail view | Deep-link only |

---

## 6. Component Patterns

### Mandatory: standalone imports
Every component must import every Ionic component it uses via `imports: [IonContent, IonHeader, ...]`. Never use wildcard imports.

### Mandatory: icon registration
Call `addIcons({ iconName })` in the **constructor** before any `<ion-icon name="...">` in the template.  
Never rely on icons being globally registered.

```ts
import { addIcons } from 'ionicons';
import { addOutline, trashOutline } from 'ionicons/icons';

constructor() {
  addIcons({ addOutline, trashOutline });
}
```

### Standard page header

```html
<ion-header class="ion-no-border">
  <ion-toolbar>
    <div class="page-header">
      <div class="user-avatar">{{ userInitial }}</div>
      <span class="page-title">Page Title</span>
      <ion-button fill="clear" (click)="goToSettings()">
        <ion-icon name="settings-outline" slot="icon-only" color="medium"></ion-icon>
      </ion-button>
    </div>
  </ion-toolbar>
</ion-header>
```

### Content area

```html
<ion-content [fullscreen]="true">
  <!-- content -->
  <div style="height: 100px;"></div>  <!-- always add bottom spacer -->
</ion-content>
```

### Currency pipe
```html
{{ amount | currency:currencyCode:'symbol':'1.0-0' }}
```
Always use dynamic `currencyCode` from `PreferencesService.getCurrencyCode$()`. No hardcoded symbols.

### ViewModel pattern (preferred for complex pages)
```ts
vm$ = combineLatest([this.engine.summary$, this.prefs.getCurrencyCode$()]).pipe(
  map(([summary, code]) => ({ summary, code }))
);
```
```html
<ng-container *ngIf="vm$ | async as vm">...</ng-container>
```

---

## 7. CSS & Theming Conventions

| Token / Class | Usage |
|---|---|
| `.card-glass` | Custom glassmorphism-style container cards |
| `<ion-card>` | Standard Ionic cards — auto-styled for dark theme via global overrides |
| Primary accent | `#2dd36f` (green) |
| Error / danger | `#ff4961` |
| Warning | `#ffc409` |
| Info | `#3dc2ff` |
| Monospace font | `'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Monaco', monospace` |
| Dark mode | Applied via `ion-palette-dark` class on `<html>` from `App.ngOnInit()` |
| `.transaction-item` | Row layout for expense/income list items |

**Rules:**
- Never hardcode light-mode colors — always use CSS variables or Ionic color tokens.
- Dark-mode-first: test every new UI in dark mode first.
- Use `color="primary"`, `color="danger"` etc. on Ionic components before reaching for inline styles.

---

## 8. AI Feature

### Architecture
- `LlmPlugin` (`src/app/core/plugins/llm-plugin.ts`) — custom Capacitor plugin (`registerPlugin('LlmPlugin')`) bridging to `com.zerowallet.tracker.LlmPlugin` on Android.
- The Android side uses **MediaPipe `LlmInference`** running on GPU/NPU — **not** Transformers.js, **not** WASM.
- **Android only** — the plugin rejects all calls on web/browser.

### Plugin methods
```ts
getModelStatus() → { status: string, exists: boolean }
downloadModel()  → streams progress events
initialize()     → loads model into memory
generate({ prompt: string }) → streams token events
reset()          → clears KV cache
deleteModel()    → removes model file from device storage
```

### AiContextService — prompt budget rules
- Hard cap: **3 200 characters** total (`MAX_CONTEXT_CHARS`).
- Sections in priority order: `header (120) → summary (350) → overdue (400) → thisMonth (500) → upcoming (600) → installments (400) → cards (300) → history (200) → goals (200) → incomes (300)`.
- Leftover budget cascades to later sections.
- When data exceeds a section's budget → aggregate (counts + totals), never list every item.

### Known TODO
The `/ai` route is defined and functional but **`TabsComponent` template is missing the `<ion-tab-button>` for the AI tab.** Adding it requires updating `src/app/features/tabs/tabs.component.html`.

---

## 9. Building the APK

> Always use `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64` — system default is Java 17, Capacitor Android requires **Java 21**.

### One-command build
```bash
bun run build:apk          # debug APK
bun run build:apk:release  # release APK (unsigned)
```

### What happens
1. `ng build` — compiles Angular to `dist/`
2. `npx cap sync android` — copies web assets into `android/app/src/main/assets/public`
3. `./gradlew assembleDebug` (or `assembleRelease`) inside `android/`

### Output
`android/app/build/outputs/apk/debug/app-debug.apk`

### VS Code Tasks
**Terminal → Run Task → `bun: build:apk`** (or `bun: build:apk:release`) — defined in `.vscode/tasks.json`.
