import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';
import {
  IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel,
} from '@ionic/angular/standalone';
import { OnboardingComponent } from '../onboarding/onboarding.component';
import { OnboardingService } from '../onboarding/onboarding.service';
import { Capacitor } from '@capacitor/core';
import { addIcons } from 'ionicons';
import {
  homeOutline, barChartOutline, receiptOutline, walletOutline, sparklesOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, OnboardingComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="app-tab-bar" aria-label="Primary navigation">
        <ion-tab-button tab="dashboard">
          <ion-icon name="home-outline" />
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="expenses">
          <ion-icon name="receipt-outline" />
          <ion-label>Expenses</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="reports">
          <ion-icon name="bar-chart-outline" />
          <ion-label>Reports</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="debts">
          <ion-icon name="wallet-outline" />
          <ion-label>Money</ion-label>
        </ion-tab-button>
        @if (showAiTab) {
          <ion-tab-button tab="ai">
            <ion-icon name="sparkles-outline" />
            <ion-label>AI</ion-label>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
    <app-onboarding />
  `,
})
export class TabsComponent implements OnInit {
  private readonly onboarding = inject(OnboardingService);
  readonly showAiTab = Capacitor.isNativePlatform();

  ngOnInit(): void {
    void this.onboarding.showIfFirstTime();
  }

  constructor() {
    addIcons({ homeOutline, barChartOutline, receiptOutline, walletOutline, sparklesOutline });
  }
}
