import { Injectable, computed, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { PendingNotificationQueueService, NewPendingNotification } from './pending-notification-queue.service';
import { monitoredSourceLabel } from './notification-sources';

export interface WalletCaptureStatus {
  supported: boolean;
  enabled: boolean;
  permissionGranted: boolean;
  listenerConnected: boolean;
}

export interface CapturedWalletNotification extends Omit<
  NewPendingNotification,
  'notificationTimestamp'
> {
  notificationTimestamp: string | number;
}

interface WalletNotificationCapturePlugin {
  getStatus(): Promise<Omit<WalletCaptureStatus, 'supported'>>;
  setCaptureEnabled(options: { enabled: boolean }): Promise<void>;
  openAccessSettings(): Promise<void>;
  getPendingNotifications(): Promise<{ notifications: CapturedWalletNotification[] }>;
  getActiveNotifications(): Promise<{
    notifications: CapturedWalletNotification[];
    serviceConnected: boolean;
  }>;
  acknowledgeNotification(options: { id: string }): Promise<void>;
  clearCapturedNotifications(): Promise<void>;
  addListener(
    eventName: 'notificationCaptured',
    listener: (notification: CapturedWalletNotification) => void
  ): Promise<PluginListenerHandle>;
}

const nativeCapture = registerPlugin<WalletNotificationCapturePlugin>('WalletNotificationCapture');

export interface WalletHistoryImportResult {
  permissionGranted: boolean;
  serviceConnected: boolean;
  accessibleCount: number;
  addedCount: number;
}

@Injectable({ providedIn: 'root' })
export class GoogleWalletCaptureService {
  private readonly _status = signal<WalletCaptureStatus>({
    supported: false,
    enabled: false,
    permissionGranted: false,
    listenerConnected: false,
  });
  private readonly _error = signal('');
  private readonly _initialized = signal(false);
  private initialization: Promise<void> | null = null;
  private eventHandle: PluginListenerHandle | null = null;
  private appStateHandle: PluginListenerHandle | null = null;

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly statusLabel = computed(() => {
    const status = this._status();
    if (!status.supported) return 'Notification capture is available on Android only.';
    if (!status.permissionGranted) return 'Notification access is not granted.';
    if (!status.listenerConnected) return 'Android notification access is granted; listener is reconnecting.';
    return status.enabled ? 'Bank and e-wallet notification capture is enabled.' : 'Capture is disabled.';
  });

  constructor(private readonly queue: PendingNotificationQueueService) {
    void this.initialize().catch(error => this.setError(error));
  }

  /** Starts native listeners and loads durable notifications waiting from the background. */
  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      this._initialized.set(true);
      return;
    }
    if (!this.initialization) this.initialization = this.initializeNative();
    return this.initialization;
  }

  /** Refreshes notification-access permission, including revocations made in Android settings. */
  async refreshStatus(): Promise<void> {
    await this.initialize();
    if (!this._status().supported) return;
    const status = await nativeCapture.getStatus();
    this._status.set({ supported: true, ...status });
    this._error.set('');
    if (status.permissionGranted) await this.flushStoredNotifications();
  }

  /** Enables or disables native capture without changing the Android access grant. */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.initialize();
    if (!this._status().supported) return;
    await nativeCapture.setCaptureEnabled({ enabled });
    await this.refreshStatus();
  }

  /** Opens Android's notification-listener access settings. */
  async openAccessSettings(): Promise<void> {
    await this.initialize();
    if (!this._status().supported) return;
    await nativeCapture.openAccessSettings();
  }

  /** Imports currently active Wallet notifications, not Android's full notification history. */
  async importPreviousNotifications(): Promise<WalletHistoryImportResult> {
    await this.refreshStatus();
    if (!this._status().permissionGranted) {
      return {
        permissionGranted: false,
        serviceConnected: false,
        accessibleCount: 0,
        addedCount: 0,
      };
    }
    const { notifications, serviceConnected } = await nativeCapture.getActiveNotifications();
    let addedCount = 0;
    for (const notification of notifications) {
      if (await this.addNotification(notification)) {
        addedCount += 1;
      } else if (await this.queue.reactivateIgnored(notification.fingerprint)) {
        addedCount += 1;
      } else {
        this.queue.resurfacePending(notification.fingerprint);
      }
    }
    return {
      permissionGranted: true,
      serviceConnected,
      accessibleCount: notifications.length,
      addedCount,
    };
  }

  /** Clears the native delivery buffer after the user clears pending candidates. */
  async clearNativeQueue(): Promise<void> {
    if (this._status().supported) await nativeCapture.clearCapturedNotifications();
  }

  private async initializeNative(): Promise<void> {
    this._status.set({
      supported: true,
      enabled: false,
      permissionGranted: false,
      listenerConnected: false,
    });
    await this.queue.ready();
    this.eventHandle = await nativeCapture.addListener('notificationCaptured', notification => {
      void this.processNotification(notification, true).catch(error => this.setError(error));
    });
    this.appStateHandle = await App.addListener('appStateChange', state => {
      if (state.isActive) {
        void this.refreshStatus().catch(error => this.setError(error));
      }
    });
    const status = await nativeCapture.getStatus();
    this._status.set({ supported: true, ...status });
    if (status.permissionGranted) await this.flushStoredNotifications();
    this._initialized.set(true);
  }

  private async flushStoredNotifications(): Promise<void> {
    const { notifications } = await nativeCapture.getPendingNotifications();
    for (const notification of notifications) {
      await this.processNotification(notification, true);
    }
  }

  private async processNotification(
    notification: CapturedWalletNotification,
    acknowledge: boolean
  ): Promise<boolean> {
    if (monitoredSourceLabel(notification.sourceApplication) === null) return false;
    const added = await this.addNotification(notification);
    if (acknowledge) {
      await nativeCapture.acknowledgeNotification({ id: notification.id });
    }
    return added;
  }

  private async addNotification(notification: CapturedWalletNotification): Promise<boolean> {
    const notificationTimestamp =
      typeof notification.notificationTimestamp === 'number'
        ? new Date(notification.notificationTimestamp).toISOString()
        : notification.notificationTimestamp;
    return this.queue.add({ ...notification, notificationTimestamp });
  }

  private setError(error: unknown): void {
    this._error.set(
      error instanceof Error ? error.message : 'Could not access bank and e-wallet notifications.'
    );
  }
}
