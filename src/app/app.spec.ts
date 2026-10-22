import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { App } from './app';
import { NotificationService } from './core/services/notification.service';
import { PreferencesService } from './core/services/preferences.service';
import { SyncService } from './core/services/sync.service';
import { GoogleWalletCaptureService } from './core/services/google-wallet-capture.service';
import { PendingNotificationQueueService } from './core/services/pending-notification-queue.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: PreferencesService,
          useValue: {
            getTheme: async () => 'system',
            getPalette: async () => 'default',
          },
        },
        { provide: NotificationService, useValue: { init: async () => undefined } },
        { provide: SyncService, useValue: { syncError: signal<string | null>(null) } },
        { provide: GoogleWalletCaptureService, useValue: { initialize: async () => undefined } },
        {
          provide: PendingNotificationQueueService,
          useValue: { candidateAdded$: new Subject(), expenseReviewFinished$: new Subject() },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the router outlet inside the Ionic app shell', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ion-app ion-router-outlet')).not.toBeNull();
  });
});
