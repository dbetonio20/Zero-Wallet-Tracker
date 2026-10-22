import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { NewWalletAccountInput, WalletAccount, WalletAccountType } from '../../core/models';
import { WalletService } from '../../core/services/wallet.service';

interface WalletAccountFormModel {
  name: string;
  type: WalletAccountType;
  openingBalance: number | null;
  notes: string;
}

/**
 * Add/edit account form, presented through ModalController so it opens immediately
 * and is not tied to the Money tab's page lifecycle.
 */
@Component({
  selector: 'app-wallet-account-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>{{ account ? 'Edit account' : 'Add account' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [disabled]="isSaving()" (click)="close()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-item>
        <ion-input label="Account name" [(ngModel)]="form.name" placeholder="e.g. GCash or Main bank" />
      </ion-item>
      <ion-item>
        <ion-select label="Account type" [(ngModel)]="form.type">
          <ion-select-option value="e-wallet">E-wallet</ion-select-option>
          <ion-select-option value="bank">Bank account</ion-select-option>
          <ion-select-option value="cash">Cash</ion-select-option>
          <ion-select-option value="savings">Savings account</ion-select-option>
          <ion-select-option value="other">Other</ion-select-option>
        </ion-select>
      </ion-item>
      @if (!account) {
        <ion-item>
          <ion-input
            [label]="'Opening balance (' + currencyCode + ')'"
            type="number"
            min="0"
            [(ngModel)]="form.openingBalance"
          />
        </ion-item>
      } @else {
        <p class="wallet-form-hint">Use Adjust balance to change this account’s balance and keep a history entry.</p>
      }
      <ion-item>
        <ion-textarea label="Notes" [(ngModel)]="form.notes" placeholder="Optional" />
      </ion-item>
      @if (formError()) {
        <p class="wallet-error" role="alert">{{ formError() }}</p>
      }
      <ion-button expand="block" class="ion-margin-top" [disabled]="isSaving()" (click)="save()">
        {{ isSaving() ? 'Saving…' : account ? 'Save changes' : 'Create account' }}
      </ion-button>
    </ion-content>
  `,
})
export class WalletAccountFormComponent implements OnInit {
  @Input() account: WalletAccount | null = null;
  @Input() currencyCode = 'PHP';

  private readonly walletService = inject(WalletService);
  private readonly modalController = inject(ModalController);

  readonly formError = signal('');
  readonly isSaving = signal(false);

  form: WalletAccountFormModel = { name: '', type: 'e-wallet', openingBalance: 0, notes: '' };

  ngOnInit(): void {
    if (this.account) {
      this.form = {
        name: this.account.name,
        type: this.account.type,
        openingBalance: this.account.openingBalance,
        notes: this.account.notes,
      };
    }
  }

  close(): void {
    if (this.isSaving()) return;
    void this.modalController.dismiss();
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;
    const openingBalance = Number(this.form.openingBalance);
    if (!this.form.name.trim()) {
      this.formError.set('Enter a name for this account.');
      return;
    }
    if (!this.account && (!Number.isFinite(openingBalance) || openingBalance < 0)) {
      this.formError.set('Enter an opening balance of zero or more.');
      return;
    }

    this.formError.set('');
    this.isSaving.set(true);
    try {
      if (this.account) {
        await this.walletService.updateAccount({
          ...this.account,
          name: this.form.name,
          type: this.form.type,
          notes: this.form.notes,
        });
      } else {
        const input: NewWalletAccountInput = {
          name: this.form.name,
          type: this.form.type,
          openingBalance,
          currency: this.currencyCode,
          notes: this.form.notes,
          isArchived: false,
        };
        await this.walletService.addAccount(input);
      }
      await this.modalController.dismiss({ saved: true });
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : 'Could not save this account.');
    } finally {
      this.isSaving.set(false);
    }
  }
}
