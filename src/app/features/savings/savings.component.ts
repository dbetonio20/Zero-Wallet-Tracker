import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonModal,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowDownOutline,
  arrowUpOutline,
  calendarOutline,
  checkmarkCircleOutline,
  closeOutline,
  createOutline,
  flagOutline,
  leafOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons';
import {
  SavingsAccount,
  SavingsAccountType,
  SavingsTransactionType,
} from '../../core/models';
import { SavingsGoalService } from '../../core/services/savings-goal.service';

interface SavingsAccountForm {
  name: string;
  type: SavingsAccountType;
  targetAmount: number | null;
  initialAmount: number | null;
  deadline: string;
  description: string;
  notes: string;
}

@Component({
  selector: 'app-savings',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    FormsModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonModal,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './savings.component.html',
})
export class SavingsComponent implements OnInit {
  @Input() currencyCode = 'PHP';
  private readonly savingsService = inject(SavingsGoalService);
  readonly accounts = this.savingsService.accounts;
  selectedAccountId: string | null = null;
  isDetailsOpen = false;
  isFormOpen = false;
  isTransactionOpen = false;
  readonly isSaving = signal(false);
  editingAccount: SavingsAccount | null = null;
  transactionType: SavingsTransactionType = 'deposit';
  transactionAmount: number | null = null;
  transactionDescription = '';
  readonly formError = signal('');
  readonly transactionError = signal('');
  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly deleteError = signal('');
  form: SavingsAccountForm = this.blankForm();

  constructor(private alertController: AlertController) {
    addIcons({
      arrowDownOutline,
      arrowUpOutline,
      calendarOutline,
      checkmarkCircleOutline,
      closeOutline,
      createOutline,
      flagOutline,
      leafOutline,
      trashOutline,
      walletOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    await this.retryLoad();
  }

  async retryLoad(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      await this.savingsService.retryLoad();
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Could not load savings accounts.');
    } finally {
      this.isLoading.set(false);
    }
  }

  get selectedAccount(): SavingsAccount | null {
    return this.accounts().find(account => account.id === this.selectedAccountId) ?? null;
  }

  get totalBalance(): number {
    return this.accounts().reduce((total, account) => total + account.currentAmount, 0);
  }

  get goalAccountsCount(): number {
    return this.accounts().filter(account => account.type === 'goal').length;
  }

  get flexibleAccountsCount(): number {
    return this.accounts().filter(account => account.type === 'flexible').length;
  }

  get generalAccountsCount(): number {
    return this.accounts().filter(account => account.type === 'general').length;
  }

  /** Opens the account details and transaction history. */
  openAccount(account: SavingsAccount): void {
    this.selectedAccountId = account.id;
    this.isDetailsOpen = true;
  }

  /** Opens the account form for creating a new savings account. */
  openCreate(): void {
    if (this.isLoading() || this.loadError()) return;
    this.editingAccount = null;
    this.form = this.blankForm();
    this.formError.set('');
    this.isFormOpen = true;
  }

  /** Opens the account form with the selected account's editable details. */
  openEdit(account: SavingsAccount): void {
    this.editingAccount = account;
    this.form = {
      name: account.name,
      type: account.type ?? 'goal',
      targetAmount: account.type === 'goal' ? account.targetAmount : null,
      initialAmount: null,
      deadline: account.deadline ?? '',
      description: account.description ?? '',
      notes: account.notes ?? '',
    };
    this.formError.set('');
    this.isDetailsOpen = false;
    this.isFormOpen = true;
  }

  closeForm(): void {
    if (this.isSaving()) return;
    this.isFormOpen = false;
    this.editingAccount = null;
    this.formError.set('');
  }

  async saveAccount(): Promise<void> {
    if (this.isSaving()) return;
    this.formError.set(this.validateForm());
    if (this.formError()) return;

    this.isSaving.set(true);
    try {
      if (this.editingAccount) {
        await this.savingsService.updateAccount({
          ...this.editingAccount,
          name: this.form.name.trim(),
          targetAmount: this.form.type === 'goal' ? Number(this.form.targetAmount) : 0,
          deadline: this.form.type === 'goal' ? this.form.deadline : undefined,
          description: this.form.description.trim() || undefined,
          notes: this.form.notes.trim() || undefined,
        });
      } else {
        await this.savingsService.addAccount({
          name: this.form.name.trim(),
          type: this.form.type,
          targetAmount: this.form.type === 'goal' ? Number(this.form.targetAmount) : undefined,
          initialAmount: this.form.initialAmount ?? 0,
          deadline: this.form.type === 'goal' ? this.form.deadline : undefined,
          description: this.form.description.trim() || undefined,
          notes: this.form.notes.trim() || undefined,
        });
      }
      this.isFormOpen = false;
      this.editingAccount = null;
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : 'Could not save this account.');
    } finally {
      this.isSaving.set(false);
    }
  }

  openTransaction(type: SavingsTransactionType, account: SavingsAccount): void {
    this.selectedAccountId = account.id;
    this.transactionType = type;
    this.transactionAmount = null;
    this.transactionDescription = '';
    this.transactionError.set('');
    this.isTransactionOpen = true;
  }

  closeTransaction(): void {
    if (this.isSaving()) return;
    this.isTransactionOpen = false;
    this.transactionError.set('');
  }

  async saveTransaction(): Promise<void> {
    if (this.isSaving()) return;
    const account = this.selectedAccount;
    const amount = Number(this.transactionAmount);
    if (!account) {
      this.transactionError.set('This savings account is no longer available.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      this.transactionError.set('Enter an amount greater than zero.');
      return;
    }
    if (this.transactionType === 'withdrawal' && amount > account.currentAmount) {
      this.transactionError.set('The withdrawal cannot exceed the available balance.');
      return;
    }

    this.isSaving.set(true);
    try {
      if (this.transactionType === 'deposit') {
        await this.savingsService.contribute(account.id, amount, this.transactionDescription);
      } else {
        await this.savingsService.withdraw(account.id, amount, this.transactionDescription);
      }
      this.isTransactionOpen = false;
    } catch (error) {
      this.transactionError.set(error instanceof Error ? error.message : 'Could not save this transaction.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async confirmDelete(account: SavingsAccount): Promise<void> {
    this.deleteError.set('');
    const transactionCount = account.transactions?.length ?? 0;
    const historyWarning = transactionCount
      ? ` It has ${transactionCount} transaction${transactionCount === 1 ? '' : 's'}; removing the account will also remove that history from the active savings view.`
      : '';
    const alert = await this.alertController.create({
      header: 'Delete savings account?',
      message: `Delete "${account.name}"? This action cannot be undone.${historyWarning}`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete account',
          role: 'destructive',
          handler: async () => {
            try {
              await this.savingsService.deleteAccount(account.id);
              this.isDetailsOpen = false;
              this.selectedAccountId = null;
              return true;
            } catch (error) {
              this.deleteError.set(error instanceof Error ? error.message : 'Could not delete this account.');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  typeLabel(type: SavingsAccountType | undefined): string {
    if (type === 'flexible') return 'Flexible savings';
    if (type === 'general') return 'General savings';
    return 'Goal savings';
  }

  typeIcon(type: SavingsAccountType | undefined): string {
    if (type === 'flexible') return 'wallet-outline';
    if (type === 'general') return 'leaf-outline';
    return 'flag-outline';
  }

  goalProgress(account: SavingsAccount): number {
    if (account.targetAmount <= 0) return 0;
    return Math.min(100, Math.round((account.currentAmount / account.targetAmount) * 100));
  }

  goalRemaining(account: SavingsAccount): number {
    return Math.max(0, account.targetAmount - account.currentAmount);
  }

  isGoalComplete(account: SavingsAccount): boolean {
    return account.type === 'goal' && account.currentAmount >= account.targetAmount;
  }

  isGoalOverdue(account: SavingsAccount): boolean {
    return account.type === 'goal' &&
      !this.isGoalComplete(account) &&
      !!account.deadline &&
      new Date(`${account.deadline}T23:59:59`).getTime() < Date.now();
  }

  sortedTransactions(account: SavingsAccount) {
    return [...(account.transactions ?? [])].sort((left, right) =>
      right.date.localeCompare(left.date)
    );
  }

  private validateForm(): string {
    if (!this.form.name.trim()) return 'Enter a name for this savings account.';
    if (this.form.type === 'goal') {
      const targetAmount = Number(this.form.targetAmount);
      if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
        return 'Enter a goal target greater than zero.';
      }
      if (!this.form.deadline || Number.isNaN(Date.parse(this.form.deadline))) {
        return 'Choose a valid target deadline.';
      }
    }
    if (
      !this.editingAccount &&
      this.form.initialAmount !== null &&
      (!Number.isFinite(this.form.initialAmount) || this.form.initialAmount < 0)
    ) {
      return 'The initial deposit cannot be negative.';
    }
    return '';
  }

  private blankForm(): SavingsAccountForm {
    return {
      name: '',
      type: 'goal',
      targetAmount: null,
      initialAmount: null,
      deadline: '',
      description: '',
      notes: '',
    };
  }
}
