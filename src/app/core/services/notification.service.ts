import { Injectable, inject } from '@angular/core';
import { combineLatest, firstValueFrom } from 'rxjs';
import { LocalNotifications } from '@capacitor/local-notifications';
import { FinancialEngineService } from './financial-engine.service';
import { CreditCardService } from './credit-card.service';
import { PreferencesService } from './preferences.service';
import { Expense, InstallmentPayment, Installment, CreditCard } from '../models';

const NOTIF_CHANNEL = 'due-date-alerts';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private engine = inject(FinancialEngineService);
  private cardService = inject(CreditCardService);
  private prefs = inject(PreferencesService);

  /** Request permission and schedule all due-date notifications. Call on app init. */
  async init(): Promise<void> {
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== 'granted') return;

    // Create Android notification channel
    await LocalNotifications.createChannel({
      id: NOTIF_CHANNEL,
      name: 'Due Date Alerts',
      description: 'Reminders for upcoming and overdue payments',
      importance: 4,
      visibility: 1,
      vibration: true,
    }).catch(() => {/* web/iOS – ignore */});

    await this.scheduleAll();
  }

  /** Re-schedule all notifications. Call whenever data changes. */
  async scheduleAll(): Promise<void> {
    // Cancel all previously scheduled notifications
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }

    const [expenses, payments, installments, cards] = await firstValueFrom(
      combineLatest([
        this.engine.getExpenses(),
        this.engine.getInstallmentPayments(),
        this.engine.getInstallments(),
        this.cardService.getCards(),
      ])
    );

    const now = new Date();
    const notifications: {
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
      channelId: string;
    }[] = [];

    let idCounter = 1000; // start well above 0 to avoid conflicts

    const push = (title: string, body: string, at: Date) => {
      if (at > now) {
        notifications.push({ id: idCounter++, title, body, schedule: { at }, channelId: NOTIF_CHANNEL });
      }
    };

    // ── Unpaid Expenses ───────────────────────────────────
    for (const e of expenses) {
      if (e.status === 'paid') continue;
      const due = new Date(e.date);
      due.setHours(9, 0, 0, 0);

      const minus5 = new Date(due);
      minus5.setDate(minus5.getDate() - 5);

      push(`${e.category} due in 5 days`, `${e.name || e.category}  ·  ${this.fmt(e.amount)}`, minus5);
      push(`${e.category} due today`, `${e.name || e.category}  ·  ${this.fmt(e.amount)} – due today!`, due);
    }

    // ── Unpaid Installment Payments ───────────────────────
    const installmentMap = new Map<string, Installment>(installments.map(i => [i.id, i]));

    for (const p of payments) {
      if (p.status === 'paid') continue;
      const inst = installmentMap.get(p.installmentId);
      const label = inst?.transaction ?? 'Installment';
      const due = new Date(p.dueDate);
      due.setHours(9, 0, 0, 0);

      const minus5 = new Date(due);
      minus5.setDate(minus5.getDate() - 5);

      push(`${label} due in 5 days`, `${this.fmt(p.amount)} installment payment`, minus5);
      push(`${label} due today`, `${this.fmt(p.amount)} installment – due today!`, due);
    }

    // ── Credit Card Billing Dates ─────────────────────────
    for (const card of cards) {
      const cardLabel = `${card.bank} – ${card.name}`;

      // Collect unpaid installment payments linked to this card
      const unpaidForCard = payments.filter(p => {
        if (p.status === 'paid') return false;
        const inst = installmentMap.get(p.installmentId);
        return inst?.cardId === card.id;
      });
      if (unpaidForCard.length === 0) continue;

      const totalUnpaid = unpaidForCard.reduce((s, p) => s + p.amount, 0);

      // Build the billing due date for the nearest relevant month
      const due = this.nextDueDate(card.dueDate);
      due.setHours(9, 0, 0, 0);

      const minus5 = new Date(due);
      minus5.setDate(minus5.getDate() - 5);

      push(
        `${cardLabel} bill in 5 days`,
        `${unpaidForCard.length} payment${unpaidForCard.length !== 1 ? 's' : ''}  ·  ${this.fmt(totalUnpaid)} due`,
        minus5
      );
      push(
        `${cardLabel} bill due today`,
        `${unpaidForCard.length} payment${unpaidForCard.length !== 1 ? 's' : ''}  ·  ${this.fmt(totalUnpaid)} – due today!`,
        due
      );
    }

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications });
    }
  }

  // ── Helpers ────────────────────────────────────────────

  /** Return the next occurrence of a given day-of-month (today or future). */
  private nextDueDate(dayOfMonth: number): Date {
    const today = new Date();
    const candidate = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    if (candidate < today) {
      candidate.setMonth(candidate.getMonth() + 1);
    }
    return candidate;
  }

  private fmt(amount: number): string {
    const sym = this.prefs.currentCurrencySymbol ?? '₱';
    return sym + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
}
