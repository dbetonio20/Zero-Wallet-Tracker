import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel,
  IonModal, IonButton, IonButtons, IonIcon, IonInput, IonCheckbox,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, walletOutline, checkmarkCircleOutline, cashOutline } from 'ionicons/icons';
import { FinancialEngineService } from '../../../core/services/financial-engine.service';
import { Income } from '../../../core/models';

export interface PayModalResult {
  allocations: { incomeId: string; amount: number }[];
  withoutIncome: boolean;
}

interface IncomeOption {
  income: Income;
  selected: boolean;
  allocatedAmount: number;
  used: number;
  remaining: number;
}

@Component({
  selector: 'app-pay-modal',
  standalone: true,
  imports: [
    CommonModule, CurrencyPipe, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonModal, IonButton, IonButtons, IonIcon, IonInput, IonCheckbox,
  ],
  template: `
    <ion-modal [isOpen]="isOpen" (didDismiss)="onDismiss()" [breakpoints]="[0, 0.85]" [initialBreakpoint]="0.85">
      <ng-template>
        <ion-header class="ion-no-border">
          <ion-toolbar class="modal-toolbar">
            <ion-title>Pay {{ itemName }}</ion-title>
            <ion-buttons slot="end">
              <ion-button (click)="onDismiss()" class="modal-close-btn">
                <ion-icon name="close-outline" slot="icon-only"></ion-icon>
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding modal-content">
          <div class="pay-modal-amount">
            <div class="pay-modal-amount-label">Amount to pay</div>
            <div class="pay-modal-amount-value">{{ amount | currency:currencyCode:'symbol':'1.0-0' }}</div>
          </div>

          @if (incomeOptions.length) {
            <div class="pay-modal-section-title">Select income source(s)</div>
            <div class="card-glass">
              @for (opt of incomeOptions; track opt.income.id) {
                <div class="pay-income-row" [class.selected]="opt.selected" (click)="toggleIncome(opt)">
                  <div class="pay-income-check">
                    <ion-checkbox [checked]="opt.selected" (ionChange)="toggleIncome(opt, $event)" />
                  </div>
                  <div class="pay-income-info">
                    <div class="pay-income-name">{{ opt.income.source }}</div>
                    <div class="pay-income-date">{{ opt.income.date }}</div>
                    <div class="pay-income-remaining">
                      Remaining: {{ opt.remaining | currency:currencyCode:'symbol':'1.0-0' }}
                      <span class="pay-income-total">/ {{ opt.income.amount | currency:currencyCode:'symbol':'1.0-0' }}</span>
                    </div>
                  </div>
                  @if (opt.selected) {
                    <div class="pay-income-amount-input">
                      <ion-input
                        type="number"
                        [(ngModel)]="opt.allocatedAmount"
                        [max]="opt.remaining"
                        [min]="0"
                        placeholder="0"
                        (ionInput)="onAmountChange()"
                        class="pay-amount-field"
                      />
                    </div>
                  }
                </div>
              }
            </div>

            <div class="pay-modal-summary">
              <div class="pay-modal-summary-row">
                <span>Allocated</span>
                <span [class.success-text]="totalAllocated === amount" [class.danger-text]="totalAllocated > amount">
                  {{ totalAllocated | currency:currencyCode:'symbol':'1.0-0' }}
                </span>
              </div>
              <div class="pay-modal-summary-row">
                <span>Remaining</span>
                <span>{{ remainingToPay | currency:currencyCode:'symbol':'1.0-0' }}</span>
              </div>
            </div>

            <ion-button
              expand="block"
              class="save-btn"
              [disabled]="totalAllocated <= 0 || totalAllocated > amount"
              (click)="confirmPay()"
            >
              <ion-icon name="checkmark-circle-outline" slot="start" />
              Pay with Income
            </ion-button>
          } @else {
            <div class="empty-state">
              <ion-icon name="wallet-outline" class="empty-icon"></ion-icon>
              <p>No income recorded yet</p>
            </div>
          }

          <ion-button
            expand="block"
            fill="outline"
            class="pay-without-btn ion-margin-top"
            (click)="payWithoutIncome()"
          >
            <ion-icon name="cash-outline" slot="start" />
            Pay without linking income
          </ion-button>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
})
export class PayModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() amount = 0;
  @Input() itemName = '';
  @Input() currencyCode = 'PHP';
  @Output() dismissed = new EventEmitter<void>();
  @Output() paid = new EventEmitter<PayModalResult>();

  incomeOptions: IncomeOption[] = [];
  totalAllocated = 0;
  remainingToPay = 0;

  constructor(private engine: FinancialEngineService) {
    addIcons({ closeOutline, walletOutline, checkmarkCircleOutline, cashOutline });
  }

  ngOnInit(): void {
    this.loadIncomes();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.loadIncomes();
    }
  }

  private loadIncomes(): void {
    this.engine.getIncomes().subscribe(incomes => {
      this.incomeOptions = incomes.map(income => ({
        income,
        selected: false,
        allocatedAmount: 0,
        used: this.engine.getIncomeUsed(income.id),
        remaining: this.engine.getIncomeRemaining(income.id),
      })).filter(opt => opt.remaining > 0); // Only show incomes with available balance
      this.recalculate();
    });
  }

  toggleIncome(opt: IncomeOption, event?: any): void {
    if (event) {
      event.stopPropagation?.();
    }
    opt.selected = !opt.selected;
    if (opt.selected) {
      // Auto-fill with the lesser of remaining income or remaining to pay
      const needed = this.amount - this.getOtherAllocated(opt);
      opt.allocatedAmount = Math.min(opt.remaining, Math.max(0, needed));
    } else {
      opt.allocatedAmount = 0;
    }
    this.recalculate();
  }

  onAmountChange(): void {
    this.recalculate();
  }

  private getOtherAllocated(exclude: IncomeOption): number {
    return this.incomeOptions
      .filter(o => o !== exclude && o.selected)
      .reduce((s, o) => s + (o.allocatedAmount || 0), 0);
  }

  private recalculate(): void {
    this.totalAllocated = this.incomeOptions
      .filter(o => o.selected)
      .reduce((s, o) => s + (o.allocatedAmount || 0), 0);
    this.remainingToPay = Math.max(0, this.amount - this.totalAllocated);
  }

  confirmPay(): void {
    const allocations = this.incomeOptions
      .filter(o => o.selected && o.allocatedAmount > 0)
      .map(o => ({ incomeId: o.income.id, amount: o.allocatedAmount }));
    this.paid.emit({ allocations, withoutIncome: false });
    this.reset();
  }

  payWithoutIncome(): void {
    this.paid.emit({ allocations: [], withoutIncome: true });
    this.reset();
  }

  onDismiss(): void {
    this.dismissed.emit();
    this.reset();
  }

  private reset(): void {
    this.incomeOptions.forEach(o => {
      o.selected = false;
      o.allocatedAmount = 0;
    });
    this.recalculate();
  }
}
