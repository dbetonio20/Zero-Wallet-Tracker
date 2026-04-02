---
name: angular-best-practices
description: 'Angular developer skill for writing clean, idiomatic Angular code. Use when: creating Angular components, services, pipes, directives; reviewing Angular code; adding state with signals or observables; setting up standalone components; implementing CRUD services; writing clean code; applying Angular best practices; refactoring Angular code; using ChangeDetectionStrategy.OnPush; structuring templates with async pipe or vm$ pattern.'
argument-hint: 'Optional: describe the feature or file you are working on'
---

# Angular Best Practices — Clean Code Skill

## When to Use

Invoke this skill whenever you are:

- Creating or editing an Angular **component, service, pipe, or directive**
- Implementing **state management** with signals or observables
- Reviewing Angular code for correctness and idiomatic style
- Structuring templates with the `async` pipe or `vm$` pattern
- Adding **CRUD operations** to a service
- Asking for "clean Angular code", "best practices", or "refactor"

---

## 1. Standalone Components — Mandatory Checklist

Every component MUST:

- [ ] Declare `standalone: true`
- [ ] List every import explicitly in `imports: []` — no barrel re-exports, no `CommonModule`
- [ ] Set `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Register all Ionicons in the **constructor** via `addIcons({})` (if using `<ion-icon>`)
- [ ] Use `inject()` for dependency injection (not constructor parameters for non-services)
- [ ] Clean up subscriptions with `takeUntilDestroyed(this.destroyRef)`

```typescript
import { Component, ChangeDetectionStrategy, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AsyncPipe, CurrencyPipe } from '@angular/common';

@Component({
  selector: 'app-my-feature',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
    CurrencyPipe,
    // ...list every Ionic component used in template
  ],
  templateUrl: './my-feature.component.html',
})
export class MyFeatureComponent {
  private readonly myService = inject(MyService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    addIcons({ addOutline, trashOutline }); // register before template renders
  }
}
```

---

## 2. Signal-Based State in Services

### Standard Pattern (3-layer exposure)

```typescript
import { Injectable, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class MyService {
  // 1. Private writable — only this service mutates
  private readonly _items = signal<Item[]>([]);

  // 2. Public read-only — for direct reads and computed()
  readonly items = this._items.asReadonly();

  // 3. Observable alias — for async pipe and combineLatest consumers
  readonly items$ = toObservable(this._items);

  // Derived state — recalculates automatically when dependencies change
  readonly total = computed(() =>
    this._items().reduce((sum, item) => sum + item.amount, 0)
  );
  readonly total$ = toObservable(this.total);
}
```

### Rules

- **Do NOT use `BehaviorSubject` for new state** — use `signal()` instead
- Use `Subject<void>` only for one-shot event buses (not state)
- Use `effect()` only for side effects that must react to signal changes
- Use `toSignal()` to consume Observables in signal-based contexts

---

## 3. CRUD Service Template

```typescript
import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { StorageService } from './storage.service';

const STORAGE_KEY = 'my_items';

@Injectable({ providedIn: 'root' })
export class MyItemService {
  private readonly storage = inject(StorageService);

  private readonly _items = signal<MyItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly items$ = toObservable(this._items);

  /** Load persisted items — call once after StorageService is ready. */
  async load(): Promise<void> {
    const saved = await this.storage.getList<MyItem>(STORAGE_KEY);
    this._items.set(saved ?? []);
  }

  /** Add a new item (generates a UUID). */
  async add(item: Omit<MyItem, 'id'>): Promise<void> {
    const withId: MyItem = { ...item, id: crypto.randomUUID() };
    const updated = [...this._items(), withId];
    await this.storage.saveList(STORAGE_KEY, updated);
    this._items.set(updated);
  }

  /** Replace an existing item matched by id. */
  async update(item: MyItem): Promise<void> {
    const updated = this._items().map(x => (x.id === item.id ? item : x));
    await this.storage.saveList(STORAGE_KEY, updated);
    this._items.set(updated);
  }

  /** Remove an item by id. */
  async delete(id: string): Promise<void> {
    const updated = this._items().filter(x => x.id !== id);
    await this.storage.saveList(STORAGE_KEY, updated);
    this._items.set(updated);
  }
}
```

---

## 4. Template Patterns

### 4a. Simple Signal Read (preferred for single values)

```html
<!-- In template — signals are called as functions -->
<span>Total: {{ myService.total() }}</span>
```

### 4b. Async Pipe with ViewModel (preferred for complex pages)

```typescript
// Component class
readonly vm$ = combineLatest([
  this.engine.summary$,
  this.prefs.currencyCode$,
]).pipe(
  map(([summary, currencyCode]) => ({ summary, currencyCode }))
);
```

```html
@if (vm$ | async; as vm) {
  <span>{{ vm.summary.balance | currency:vm.currencyCode:'symbol':'1.0-0' }}</span>
}
```

### 4c. Control-Flow (Angular 17+)

Prefer new control-flow syntax over structural directives:

```html
@if (condition) { ... } @else { ... }
@for (item of items; track item.id) { ... } @empty { <p>No items</p> }
@switch (status) { @case ('paid') { ... } @default { ... } }
```

### 4d. Currency — always dynamic

```html
<!-- ✅ Correct — dynamic code from PreferencesService -->
{{ amount | currency:currencyCode:'symbol':'1.0-0' }}

<!-- ❌ Wrong — hardcoded symbol -->
{{ amount | currency:'USD':'symbol':'1.0-0' }}
```

`currencyCode` must come from `PreferencesService.currencyCode` (signal) or `currencyCode$` (async pipe).

---

## 5. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `expense-list.component.ts` |
| Components | `PascalCase` + suffix | `ExpenseListComponent` |
| Services | `PascalCase` + `Service` | `FinancialEngineService` |
| Private signals | `_camelCase` | `_expenses` |
| Public signal (read-only) | `camelCase` | `expenses` |
| Observable alias | `camelCase$` | `expenses$` |
| Computed | `camelCase` (noun) | `total`, `summary` |
| ViewModel interfaces | `PascalCase` + `VM` | `DashboardVM`, `IncomeVM` |
| Storage keys | `snake_case` string const | `'credit_cards'`, `'pref_theme'` |
| Methods | `camelCase` verb | `addExpense()`, `markAsPaid()` |

---

## 6. Clean Code Rules

### No `any` Types

```typescript
// ❌ Bad
function process(data: any) { ... }

// ✅ Good
function process(data: Expense[]): FinancialSummary { ... }
```

### Extract Template Logic

```typescript
// ❌ Bad — logic in template
// {{ items.filter(x => x.status === 'paid').length }}

// ✅ Good — computed property or getter
readonly paidCount = computed(() =>
  this._items().filter(x => x.status === 'paid').length
);
```

### Single Responsibility

- One service = one domain entity (expenses, cards, categories…)
- Keep components as thin orchestrators — push logic to services
- Pure transformation functions belong in `computed()` or standalone utility functions

### No Magic Values

```typescript
// ❌ Bad
if (days <= 7) { ... }

// ✅ Good
const UPCOMING_THRESHOLD_DAYS = 7;
if (days <= UPCOMING_THRESHOLD_DAYS) { ... }
```

### Subscriptions — always clean up

```typescript
// ✅ Use takeUntilDestroyed — no manual ngOnDestroy needed
this.someService.events$
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(event => this.handleEvent(event));
```

---

## 7. Code Review Checklist

Before submitting or approving any Angular change:

- [ ] No `NgModule` created or referenced
- [ ] All imports in `imports[]` array are explicit (no `CommonModule`)
- [ ] `standalone: true` on all components/directives/pipes
- [ ] `ChangeDetectionStrategy.OnPush` set (new components)
- [ ] No `BehaviorSubject` used for new state (use `signal()`)
- [ ] No `any` type used
- [ ] All subscriptions cleaned up with `takeUntilDestroyed`
- [ ] Icons registered in constructor via `addIcons()`
- [ ] Currency uses dynamic `currencyCode` — no hardcoded symbols
- [ ] No logic in templates — extracted to `computed()` or methods
- [ ] JSDoc on all public service methods
- [ ] No single-letter variable names outside tight loops
- [ ] `providedIn: 'root'` on services (unless feature-scoped)

---

## 8. Anti-Patterns to Avoid

| Anti-pattern | Fix |
|---|---|
| `BehaviorSubject` for state | `signal()` + `toObservable()` |
| `NgModule` | Standalone + explicit `imports[]` |
| Subscribing manually in component without cleanup | `takeUntilDestroyed(destroyRef)` |
| `any` type | Proper interface / generic |
| Logic in template expressions | `computed()` getter in class |
| Hardcoded currency symbol | `prefs.currencyCode` signal |
| Global icon registration | `addIcons()` in component constructor |
| Side effects in `computed()` | Move to `effect()` or service method |
| `combineLatest` for derived state in services | `computed()` |
| Manual `ChangeDetectorRef.markForCheck()` everywhere | `OnPush` + `async` pipe |
