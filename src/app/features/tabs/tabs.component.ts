import { Component } from '@angular/core';
import {
  IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  homeOutline, barChartOutline, receiptOutline, walletOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard">
          <ion-icon name="home-outline" />
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="reports">
          <ion-icon name="bar-chart-outline" />
          <ion-label>Reports</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="expenses">
          <ion-icon name="receipt-outline" />
          <ion-label>Expenses</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="debts">
          <ion-icon name="wallet-outline" />
          <ion-label>Debts</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsComponent {
  constructor() {
    addIcons({ homeOutline, barChartOutline, receiptOutline, walletOutline });
  }
}
