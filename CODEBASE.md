# zero-wallet-tracker — Codebase Reference

> **Purpose:** Single-source reference for an AI agent. Reading this file is sufficient to understand the entire codebase and make precise changes without exploring individual source files.

---

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | Angular 21 (standalone components) |
| UI library | Ionic 8 (`@ionic/angular/standalone`, forced MD mode) |
| Charts | chart.js 4.5.1 + ng2-charts 10.0.0 |
| Storage | @ionic/storage-angular 4.0.0 (IndexedDB via localforage) |
| Native | Capacitor 8 (Android target) |
| Package manager | Bun |
| Language | TypeScript 5.9 |
| Build | Angular CLI / @angular/build |

`provideIonicAngular({ mode: 'md' })` set globally — MD mode forced everywhere.

---

## Project Structure

```
src/
  main.ts                         Bootstrap with appConfig
  styles.css                      Global styles + dark theme + all utility classes
  index.html
  app/
    app.ts                        Root component; inline template: <ion-app><ion-router-outlet />, applies theme on init
    app.config.ts                 provideRouter, provideIonicAngular, provideStorage
    app.routes.ts                 All routes (lazy-loaded under TabsComponent)
    core/
      models/index.ts             All TypeScript interfaces and types
      services/
        storage.service.ts        Generic key/value wrapper around @ionic/storage
        financial-engine.service.ts  Central data service (expenses, incomes, installments)
        credit-card.service.ts    Credit card CRUD + upcoming dues
        preferences.service.ts    User settings: name, theme, currency, export/clear
    features/
      tabs/tabs.component.ts      Bottom tab bar (4 tabs, inline template)
      dashboard/                  Home tab
      expenses/                   Categories tab
      reports/                    Reports tab
      debts/                      Debts tab (merged installments + credit cards via segment)
      settings/                   Settings page (no tab — accessed via gear icon)
```

---

## Routing (app.routes.ts)

All routes are lazy-loaded children of TabsComponent:

| Path | Component | Tab |
|---|---|---|
| /dashboard (default) | DashboardComponent | Home |
| /reports | ReportsComponent | Reports |
| /expenses | ExpensesComponent | Categories |
| /debts | DebtsComponent | Debts |
| /settings | SettingsComponent | No tab — via gear icon in header |
| ** | redirect to /dashboard | — |

---

## Models (src/app/core/models/index.ts)

```typescript
type PaymentStatus = 'pending' | 'paid' | 'overdue'

interface Expense {
  id: string
  category: string      // Food|Transport|Utilities|Rent|Entertainment|Health|Shopping|Other
  amount: number
  date: string          // ISO 'YYYY-MM-DD'
  paymentMethod: string // Cash|GCash|Credit Card|Debit Card|Bank Transfer
  status: PaymentStatus
  notes: string
}

interface Income {
  id: string
  source: string        // Salary|Freelance|Business|Investment|Bonus|Other
  amount: number
  date: string          // ISO 'YYYY-MM-DD'
  recurring: boolean
}

interface CreditCard {
  id: string
  bank: string
  name: string
  dueDate: number       // day of month (1–31)
  cutoffDate: number    // day of month
  creditLimit: number
}

interface Installment {
  id: string
  cardId: string        // '' if not linked to a card
  transaction: string   // display name e.g. 'Honda ADV'
  monthlyAmount: number
  startDate: string     // ISO 'YYYY-MM-DD'
  months: number        // total number of payments
}

interface InstallmentPayment {
  id: string
  installmentId: string // FK to Installment.id
  dueDate: string       // ISO 'YYYY-MM-DD'
  amount: number        // = Installment.monthlyAmount
  status: PaymentStatus
}

interface FinancialSummary {
  totalIncome: number
  totalExpenses: number      // sum of UNPAID expenses
  totalInstallments: number  // sum of UNPAID installment payments
  totalCreditDues: number    // ALWAYS 0 — not implemented
  balance: number            // totalIncome - totalExpenses - totalInstallments
  overdueAmount: number
  upcomingAmount: number     // pending items due within next 7 days
}
```

---

## Services

### StorageService (`src/app/core/services/storage.service.ts`)

Generic async key/value store backed by `@ionic/storage-angular`. Uses a `BehaviorSubject<boolean>` (`ready$`) to queue all calls until storage is initialized.

| Method | Description |
|---|---|
| `set(key, value)` | Saves any value |
| `get<T>(key)` | Returns T or null |
| `remove(key)` | Deletes a key |
| `getList<T>(key)` | Returns `T[]`, empty array if null |
| `saveList<T>(key, list)` | Saves an array |

---

### FinancialEngineService (`src/app/core/services/financial-engine.service.ts`)

Central reactive data service. All data held in `BehaviorSubject` streams and persisted to storage.

**Storage keys:** `'expenses'`, `'incomes'`, `'installments'`, `'installmentPayments'`

**Observables:**

| Method | Returns |
|---|---|
| `getExpenses()` | `Observable<Expense[]>` |
| `getIncomes()` | `Observable<Income[]>` |
| `getInstallments()` | `Observable<Installment[]>` |
| `getInstallmentPayments()` | `Observable<InstallmentPayment[]>` |
| `summary$` | `Observable<FinancialSummary>` — derived via combineLatest |

**CRUD methods:**
- `addExpense / updateExpense / deleteExpense`
- `addIncome / updateIncome / deleteIncome`
- `addInstallment(inst)` — creates installment + auto-generates all `InstallmentPayment` records for the full months span
- `updateInstallment(inst)` — updates installment, removes old payments and regenerates payment schedule
- `deleteInstallment(id)` — removes installment + all its payments
- `markPayment(paymentId, status)` — updates single payment status
- `loadAll()` — reloads all data from storage (call on pull-to-refresh)

**Status logic:** On every `loadAll()`, `updateStatuses()` runs: if expense/payment date is before today and status is not `'paid'`, it becomes `'overdue'`; otherwise `'pending'`.

**Known limitation:** `totalCreditDues` is computed from unpaid installment payments linked to credit cards. Credit card balances without installments are not tracked.

---

### CreditCardService (`src/app/core/services/credit-card.service.ts`)

**Storage key:** `'credit_cards'`

| Method | Description |
|---|---|
| `getCards()` | `Observable<CreditCard[]>` |
| `addCard / updateCard / deleteCard` | CRUD |
| `getById(id)` | Synchronous lookup from in-memory BehaviorSubject |
| `getUpcomingDues(days = 7)` | Cards whose next due date falls within N days |

---

### PreferencesService (`src/app/core/services/preferences.service.ts`)

**Storage keys:** `pref_user_name`, `pref_theme`, `pref_currency_symbol`, `pref_currency_code`

| Method | Default |
|---|---|
| `getUserName() / setUserName(name)` | `'User'` |
| `getTheme() / setTheme(theme)` | `'system'` — values: `'system'`/`'dark'`/`'light'` |
| `getCurrencySymbol() / getCurrencyCode()` | `'₱'` / `'PHP'` |
| `setCurrency(symbol, code)` | Updates storage + BehaviorSubjects |
| `currentCurrencyCode` / `currentCurrencySymbol` | Synchronous getters from BehaviorSubject |
| `getCurrencyCode$() / getCurrencySymbol$()` | Reactive observables |
| `getUserInitial(name)` | First char uppercased |
| `clearAllData()` | Removes all app storage keys |
| `exportAllData()` | Returns JSON string of all data for file download |

---

## Components

### TabsComponent (`features/tabs/tabs.component.ts`)

Inline template. 4 bottom tabs:

| `tab=` | Icon | Label |
|---|---|---|
| `dashboard` | `home-outline` | Home |
| `reports` | `bar-chart-outline` | Reports |
| `expenses` | `pricetags-outline` | Categories |
| `debts` | `wallet-outline` | Debts |

---

### DashboardComponent (`features/dashboard/`)

**Observable:** `vm$: Observable<DashboardVM>` combining all streams.

**DashboardVM:**
```typescript
{
  summary: FinancialSummary
  incomes: Income[]
  overdueExpenses: Expense[]       // status === 'overdue'
  upcomingExpenses: Expense[]      // pending, date <= today+7
  overduePayments: InstallmentPayment[]
  upcomingPayments: InstallmentPayment[]
  upcomingCardDues: CreditCard[]   // due date within 7 days
}
```

**State:** `isIncomeModalOpen`, `editingIncome: Income | null`, `incomeForm: Partial<Income>`, `userName`, `userInitial`

**Methods:** `buildVM()`, `handleRefresh(event)`, `openAddIncome / openEditIncome / closeIncomeModal / saveIncome / deleteIncome`, `goToSettings()`

**Template sections:**
1. `page-header` — user avatar + "Home" title + settings gear icon
2. Hero balance card — large amount + income/expense breakdown row
3. 3-column stats grid — overdue / upcoming 7d / installments
4. Overdue section — `card-glass` with transaction items
5. Upcoming section — `card-glass` with transaction items
6. Income section — `card-glass` with sliding Ionic list (edit/delete swipe)
7. Income add/edit modal — bottom sheet, `breakpoints=[0, 0.65]`, `initialBreakpoint=0.65`

**Injected services:** FinancialEngineService, CreditCardService, PreferencesService, Router

---

### ExpensesComponent (`features/expenses/`)

**Observable:** `expenses$` from `engine.getExpenses()`

**State:** `isModalOpen`, `editingExpense: Expense | null`, `form: Partial<Expense>`, `userName`, `userInitial`, `currencyCode`

**Constants:**
- `CATEGORIES`: Food, Transport, Utilities, Rent, Entertainment, Health, Shopping, Other
- `METHODS`: Cash, GCash, Credit Card, Debit Card, Bank Transfer

**Methods:** `openModal / openEditExpense / closeModal / save`, `markPaid(e)`, `delete(id)`, `badgeColor(status)`, `goToSettings()`

**Template:** page-header, sliding expense list (edit + mark-paid + delete swipe actions), FAB add button, add/edit expense modal.

---

### ReportsComponent (`features/reports/`)

**Pattern:** Subscription (NOT async pipe). Subscribes to `engine.getExpenses()` in ngOnInit, stores in `allExpenses`, calls `rebuildView()` on each emission.

**State:**
```typescript
selectedYear: number           // current year on init
selectedMonth: number          // current month 0-indexed on init
years: number[]                // [lastYear, currentYear]
months: string[]               // full month name array (12 entries)
allExpenses: Expense[]
filteredExpenses: Expense[]
totalForMonth: number
avgPerDay: number
categories: CategoryBreakdown[]  // { category, amount, color }
calendarWeeks: CalendarDay[][]   // 2D array for calendar rendering
donutData: ChartData<'doughnut'>
donutOptions: ChartOptions<'doughnut'>
```

**CalendarDay:** `{ day: number | null, hasExpense: boolean, isToday: boolean, isHighSpend: boolean, total: number }`

**Chart.js registered:** ArcElement, Tooltip, Legend, DoughnutController
**Donut config:** `type='doughnut'`, `cutout: '65%'`, legend hidden (custom HTML legend used)

**Category colors:**
- Food → #4ade80, Transport → #facc15, Utilities → #f97316, Rent → #ec4899
- Entertainment → #3b82f6, Health → #14b8a6, Shopping → #c084fc, Other → #94a3b8

**Calendar logic:** `firstDay = new Date(year, month, 1).getDay()` leading empty cells. `isHighSpend = total >= 60% of maxDaily`. Weeks are arrays of 7 CalendarDay (trailing cells padded with null).

**Template sections:**
1. page-header — avatar + "Reports" + gear
2. Horizontal scrollable year + month chip selector
3. Two green summary cards: Total / Avg/Day
4. Donut chart (max 280px centered)
5. Category legend — colored dots + "Category: ₱amount" per item
6. 7-column calendar grid with expense highlights

---

### DebtsComponent (`features/debts/`)

**Segment:** `activeSegment: 'installments' | 'cards'`

**State:** `vm$: Observable<InstallmentVM[]>`, `cards$: Observable<CreditCard[]>`, `isInstallmentModalOpen`, `isCardModalOpen`, `installmentForm`, `cardForm`, `userInitial`

**InstallmentVM** extends Installment with: `cardName: string`, `payments: InstallmentPayment[]`, `paidCount: number`, `remainingMonths: number`

**Methods:**
- `openAddModal()` — delegates to installment or card modal based on `activeSegment`
- `saveInstallment / deleteInstallment / markPaid`
- `saveCard / deleteCard`
- `nextDueDate(card): Date` — next upcoming due date
- `ordinal(n): string` — 1st/2nd/3rd/etc. suffix
- `goToSettings()`

**Template:** page-header, segment toggle, installment accordion group (each accordion shows full payment schedule with mark-paid swipe), credit card tiles showing bank/name/due/cutoff/limit/nextDue, FAB (delegates add to correct modal), add-installment modal, add-card modal.

---

### SettingsComponent (`features/settings/`)

**State:** `userName`, `theme`, `currencySymbol`, `currencyCode`

**Methods:**
- `changeName()` — Ionic alert with text input field
- `changeTheme()` — Ionic radio alert (system / dark / light)
- `downloadData()` — calls `prefs.exportAllData()`, creates Blob, triggers `<a>` click download as `zero-wallet-backup.json`
- `deleteAllData()` — confirmation alert → `clearAllData()` → `window.location.reload()`
- `goBack()` — navigates to `/dashboard`

**Template sections:**
1. Back button in toolbar
2. Brand header: `◐` symbol + "zero" text
3. **Appearance & Personalization** group: Choose Theme (shows current), Change Name (shows current), Change Currency Symbol (display only)
4. **Manage your Data** group: Download your data, Delete all data
5. **Help & Feedback** group: Rate the app, Github, Privacy Policy, Version v1.0

---

## Global Styles (`src/styles.css`)

**Dark mode via class:** `@import "@ionic/angular/css/palettes/dark.class.css"` — dark mode activates when `.ion-palette-dark` is on `<html>`. Applied by `App.ngOnInit()` based on stored theme preference.

**Global font:** `'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Monaco', monospace`

### CSS Custom Properties

```css
--ion-color-primary: #2dd36f      /* green — primary accent */
--ion-background-color: #121212
--ion-card-background: #1e1e1e
--ion-toolbar-background: #121212
--dashboard-bg: #121212
--card-bg: #1e1e1e
--card-border: #2a2a2a
--text-primary: #e0e0e0
--text-secondary: #888888
--accent-green: #2dd36f
--accent-red: #ff4961
--accent-yellow: #ffc409
--accent-blue: #3dc2ff
```

### Complete CSS Class Reference

**Page headers (all pages use this pattern):**
- `.page-header` — `display:flex`, avatar + title(`flex:1`) + gear icon
- `.user-avatar` — 40px white circle, black text, shows user initial

**Hero/Balance section (Dashboard):**
- `.hero-section` — dark card with border, `border-radius:16px`
- `.hero-label` — small uppercase grey text above amount
- `.hero-amount` — large green amount; `.negative` variant = red
- `.negative-warning` — red pill shown when balance < 0
- `.hero-stats` — inner row with income/expense breakdown
- `.hero-stat` / `.hero-stat-icon` / `.hero-stat-info` / `.hero-stat-label` / `.hero-stat-value`
- `.income-icon` → green bg; `.expense-icon` → red bg

**Stats grid (Dashboard):**
- `.stats-grid` — `grid-template-columns: repeat(3, 1fr)`
- `.stat-card` — dark bordered rounded card
- `.stat-card-icon` / `.stat-card-value` / `.stat-card-label`
- `.stat-overdue` → red icon; `.stat-upcoming` → yellow icon; `.stat-installment` → blue icon

**Sections:**
- `.section` — `padding: 0 16px; margin-top: 20px`
- `.section-header` — flex row, green color text
- `.section-title` — flex with bullet dot + label
- `.section-dot` — 8px circle; `.dot-danger` red; `.dot-warning` yellow; `.dot-success` green

**Transaction lists:**
- `.card-glass` — dark card container with border and overflow hidden
- `.transaction-item` — flex row: icon + info + amount, 12px padding
- `.transaction-item + .transaction-item` → top border separator
- `.transaction-icon` — 38px rounded icon container
- `.danger-bg` / `.warning-bg` / `.success-bg` / `.medium-bg` — colored icon backgrounds
- `.transaction-info` — `flex:1`, column layout
- `.transaction-name` / `.transaction-date` / `.transaction-amount`
- `.danger-text` / `.warning-text` / `.success-text` — colored text variants
- `.transparent-list` — Ionic `ion-list` with transparent background
- `.transaction-item-ionic` — Ionic `ion-item` with transparent override CSS vars

**Misc:**
- `.empty-state` — centered grey placeholder text
- `.add-btn` — green clear icon button
- `.recurring-badge` — small "Recurring" label
- `.modal-toolbar` / `.modal-close-btn` / `.modal-content` — dark modal header styles
- `.form-item` — dark rounded form field (`border-radius:12px`)
- `.save-btn` — green full-width save button, black text

**Settings page:**
- `.brand-header` / `.brand-icon` / `.brand-name` — top logo row
- `.settings-group` — dark rounded grouped ion-item container
- `.settings-value` — grey right-aligned current-value text in settings rows

**Reports page:**
- `.month-selector` — `overflow-x: auto` horizontal chip row
- `.month-chip` — dark pill; `.month-chip.active` = green bg, black text
- `.summary-row` — `grid-template-columns: 1fr 1fr`
- `.summary-card` — green background summary card
- `.summary-card-label` / `.summary-card-value`
- `.chart-container` — flex centered, `max-width: 280px`
- `.chart-legend` — wrapping flex row, `gap: 4px 16px`
- `.legend-item` / `.legend-dot` — colored dot + label per category

**Calendar:**
- `.calendar` — outer wrapper with padding
- `.calendar-header` — 7-col grid for Sun/Mon/.../Sat labels
- `.calendar-grid` — 7-col grid, `gap: 4px`
- `.calendar-day` — `aspect-ratio:1`, centered text
- `.calendar-day.has-expense` — light green tint `rgba(45,211,111,0.2)`
- `.calendar-day.today` — solid green fill
- `.calendar-day.high-spend` — darker green `rgba(45,211,111,0.4)`

**Ionic global overrides (bottom of styles.css):**
- `ion-toolbar` → `--background: transparent`
- `ion-card` → dark background, `1px solid var(--card-border)`, `box-shadow: none`, `border-radius:14px`
- `ion-tab-bar` → `--background: #1a1a1a`, top border `#2a2a2a`
- `ion-tab-button` → `--color: #666`, `--color-selected: var(--accent-green)`
- `ion-fab-button` → `--background: var(--accent-green)`, `--color: #000`
- `ion-segment-button` → `--indicator-color: var(--accent-green)`, `--color-checked: #000`
- `ion-accordion` → dark bg, border, `border-radius:14px`

---

## App Configuration (`app.config.ts`)

```typescript
provideZoneChangeDetection({ eventCoalescing: true })
provideRouter(routes, withComponentInputBinding())
provideIonicAngular({ mode: 'md' })
provideStorage()   // from @ionic/storage-angular
```

---

## Known Issues & Limitations

*All previously listed issues have been resolved:*

1. ~~`totalCreditDues` always 0~~ — **Fixed.** `FinancialEngineService.computeSummary()` now computes actual credit card dues from unpaid installment payments linked to credit cards.

2. ~~`SalaryService` is unused~~ — **Removed.** Dead code deleted.

3. ~~No edit for Expenses / Installments / Credit Cards~~ — **Fixed.** All entities now have full CRUD (add + edit + delete) with swipe-to-edit and dynamic modal titles.

4. ~~Theme setting not applied dynamically~~ — **Fixed.** Uses `dark.class.css` + `ion-palette-dark` class on `<html>`. Theme is applied on app init (`App.ngOnInit`) and changed live from Settings. Supports system/dark/light.

5. ~~`app.html` is dead code~~ — **Removed.**

6. ~~Legacy component folders~~ — **Removed.** `features/installments/` and `features/credit-cards/` deleted.

7. ~~Currency hardcoded~~ — **Fixed.** All components read `currencyCode` from `PreferencesService.currentCurrencyCode` and pass it to the currency pipe dynamically. Reports use `currencySymbol` for chart tooltips and legends. Currency can be changed from Settings.

---

## Adding New Features — Patterns to Follow

### New entity (e.g. "Budget")

1. Add interface to `src/app/core/models/index.ts`
2. Add CRUD methods + new storage key to `FinancialEngineService`, or create a new service
3. Create `src/app/features/<name>/<name>.component.ts` and `<name>.component.html`
4. Use the standard header pattern:
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
5. Add route in `app.routes.ts` as a lazy-loaded child of `TabsComponent`
6. Add `ion-tab-button` in `tabs.component.ts` and its icon to `addIcons({...})`

### New setting

1. Add storage key constant + `get/set` methods to `PreferencesService`
2. Add a `ion-item` row inside a `.settings-group` div in `settings.component.html`
3. Add corresponding handler method in `settings.component.ts`

### Styling rules

- All page headers: `<ion-header class="ion-no-border">` + `.page-header` div pattern
- Custom card layouts: use `.card-glass` CSS class, NOT `<ion-card>`
- Standard Ionic cards: use `<ion-card>` (gets dark theme via global override)
- Currency formatting: `| currency:currencyCode:'symbol':'1.0-0'` (no decimals, dynamic code from prefs)
- Icons: always call `addIcons({ iconName })` in the component constructor before using in template
- New page content area: `<ion-content [fullscreen]="true">` with `<div style="height:100px;"></div>` at the bottom for tab bar clearance
