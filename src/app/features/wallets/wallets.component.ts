import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  ModalController,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  archiveOutline,
  arrowDownOutline,
  arrowForwardOutline,
  arrowUpOutline,
  cashOutline,
  closeOutline,
  createOutline,
  refreshOutline,
  swapHorizontalOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { NewWalletAccountInput, WalletAccount, WalletAccountType } from '../../core/models';
import { WalletService } from '../../core/services/wallet.service';
import { WalletAccountFormComponent } from './wallet-account-form.component';

@Component({
  selector: 'app-wallets',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    FormsModule,
    IonBadge,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wallets.component.html',
})
export class WalletsComponent implements OnInit {
  @Input() currencyCode = 'PHP';
  private readonly walletService = inject(WalletService);
  private readonly alertController = inject(AlertController);
  private readonly modalController = inject(ModalController);

  readonly accounts = this.walletService.accounts;
  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly actionError = signal('');
  readonly accountView = signal<'active' | 'archived'>('active');
  readonly countActive = computed(() => this.accounts().filter(account => !account.isArchived).length);
  readonly countArchived = computed(() => this.accounts().filter(account => account.isArchived).length);
  readonly visibleAccounts = computed(() =>
    this.accounts().filter(account => account.isArchived === (this.accountView() === 'archived'))
  );
  readonly transferError = signal('');
  readonly adjustmentError = signal('');

  isTransferOpen = false;
  isAdjustmentOpen = false;
  isHistoryOpen = false;
  selectedAccount: WalletAccount | null = null;
  isSaving = false;
  transferForm = {
    sourceId: '',
    destinationId: '',
    amount: null as number | null,
    date: this.today(),
    note: '',
  };
  adjustmentForm = {
    accountId: '',
    balance: null as number | null,
    date: this.today(),
    reason: '',
  };

  constructor() {
    addIcons({
      addOutline,
      archiveOutline,
      refreshOutline,
      trashOutline,
      arrowDownOutline,
      arrowForwardOutline,
      arrowUpOutline,
      cashOutline,
      closeOutline,
      createOutline,
      swapHorizontalOutline,
      timeOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    await this.retryLoad();
  }

  async retryLoad(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      await this.walletService.retryLoad();
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Could not load accounts.');
    } finally {
      this.isLoading.set(false);
    }
  }

  balance(account: WalletAccount): number {
    return this.walletService.getBalance(account);
  }

  /** Opens the add-account form in its own modal, so it appears immediately. */
  async openCreate(): Promise<void> {
    await this.presentAccountForm(null);
  }

  async openEdit(account: WalletAccount): Promise<void> {
    await this.presentAccountForm(account);
  }

  private async presentAccountForm(account: WalletAccount | null): Promise<void> {
    const modal = await this.modalController.create({
      component: WalletAccountFormComponent,
      componentProps: { account, currencyCode: this.currencyCode },
    });
    await modal.present();
  }

  openHistory(account: WalletAccount): void {
    this.selectedAccount = account;
    this.isHistoryOpen = true;
  }

  historyTransactions(account: WalletAccount) {
    return account.transactions
      .filter(transaction => !transaction.voided)
      .sort((left, right) => right.date.localeCompare(left.date));
  }

  openTransfer(): void {
    const active = this.activeAccounts();
    this.transferForm = {
      sourceId: active[0]?.id ?? '',
      destinationId: active[1]?.id ?? '',
      amount: null,
      date: this.today(),
      note: '',
    };
    this.transferError.set('');
    this.isTransferOpen = true;
  }

  async saveTransfer(): Promise<void> {
    if (this.isSaving) return;
    this.transferError.set('');
    this.isSaving = true;
    try {
      await this.walletService.transfer(
        this.transferForm.sourceId,
        this.transferForm.destinationId,
        Number(this.transferForm.amount),
        this.transferForm.date,
        this.transferForm.note
      );
      this.isTransferOpen = false;
    } catch (error) {
      this.transferError.set(error instanceof Error ? error.message : 'Could not transfer funds.');
    } finally {
      this.isSaving = false;
    }
  }

  openAdjustment(account?: WalletAccount): void {
    const firstAccount = account ?? this.activeAccounts()[0];
    this.adjustmentForm = {
      accountId: firstAccount?.id ?? '',
      balance: firstAccount ? this.balance(firstAccount) : null,
      date: this.today(),
      reason: '',
    };
    this.adjustmentError.set('');
    this.isAdjustmentOpen = true;
  }

  async saveAdjustment(): Promise<void> {
    if (this.isSaving) return;
    this.adjustmentError.set('');
    this.isSaving = true;
    try {
      await this.walletService.adjustBalance(
        this.adjustmentForm.accountId,
        Number(this.adjustmentForm.balance),
        this.adjustmentForm.date,
        this.adjustmentForm.reason
      );
      this.isAdjustmentOpen = false;
    } catch (error) {
      this.adjustmentError.set(error instanceof Error ? error.message : 'Could not adjust balance.');
    } finally {
      this.isSaving = false;
    }
  }

  async archive(account: WalletAccount): Promise<void> {
    await this.runAction(() => this.walletService.archiveAccount(account.id), 'Could not archive this account.');
  }

  async restore(account: WalletAccount): Promise<void> {
    await this.runAction(() => this.walletService.unarchiveAccount(account.id), 'Could not restore this account.');
  }

  async confirmDelete(account: WalletAccount): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Delete account',
      message: `Delete "${account.name}"? This only works for accounts with no transactions or linked records. Use Archive to keep history.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () =>
            this.runAction(() => this.walletService.deleteAccount(account.id), 'Could not delete this account.'),
        },
      ],
    });
    await alert.present();
  }

  private async runAction(action: () => Promise<void>, fallback: string): Promise<void> {
    this.actionError.set('');
    try {
      await action();
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : fallback);
    }
  }

  private activeAccounts(): WalletAccount[] {
    return this.accounts().filter(account => !account.isArchived);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
