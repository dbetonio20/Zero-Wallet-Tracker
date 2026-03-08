import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/tabs/tabs.component').then(m => m.TabsComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'expenses',
        loadComponent: () => import('./features/expenses/expenses.component').then(m => m.ExpensesComponent),
      },
      {
        path: 'debts',
        loadComponent: () => import('./features/debts/debts.component').then(m => m.DebtsComponent),
      },
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/reports.component').then(m => m.ReportsComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent),
      },
      {
        path: 'income/:id',
        loadComponent: () => import('./features/income-detail/income-detail.component').then(m => m.IncomeDetailComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
