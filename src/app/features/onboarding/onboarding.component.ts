import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, receiptOutline, homeOutline, flagOutline, cashOutline, leafOutline,
  arrowForwardOutline,
} from 'ionicons/icons';
import { OnboardingService } from './onboarding.service';

interface OnboardingStep {
  icon: string;
  title: string;
  text: string;
  /** Tab id to spotlight, or null for a centered card. */
  tab: string | null;
  route?: string;
  savings?: boolean;
}

interface SpotRect { top: number; left: number; width: number; height: number; }

const STEPS: OnboardingStep[] = [
  { icon: 'wallet-outline', title: 'Welcome to Salapi', text: 'Track your money, manage expenses and organize savings — simply.', tab: null },
  { icon: 'home-outline', title: 'Your money at a glance', text: 'Home shows your balance, income and what’s due soon.', tab: 'dashboard', route: '/dashboard' },
  { icon: 'receipt-outline', title: 'Record your spending', text: 'Add expenses in seconds and mark them paid as you go.', tab: 'expenses', route: '/expenses' },
  { icon: 'flag-outline', title: 'Save with purpose', text: 'Find Savings under the Money tab. Pick what fits you:', tab: 'debts', route: '/debts', savings: true },
  { icon: 'leaf-outline', title: 'You’re all set!', text: 'Start tracking and watch your money grow.', tab: null, route: '/dashboard' },
];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './onboarding.component.scss',
  template: `
    @if (onboarding.visible()) {
      <div class="ob-root" role="dialog" aria-modal="true" aria-label="App walkthrough">
        @if (spot(); as rect) {
          <div class="ob-spot" [style.top.px]="rect.top" [style.left.px]="rect.left"
               [style.width.px]="rect.width" [style.height.px]="rect.height"></div>
        } @else {
          <div class="ob-dim"></div>
        }

        <div class="ob-card" [class.ob-card-center]="!spot()" [style.bottom.px]="spot() ? cardBottom() : null">
          @for (s of [step()]; track index()) {
            <div class="ob-body">
              <div class="ob-icon"><ion-icon [name]="s.icon" /></div>
              <h2>{{ s.title }}</h2>
              <p>{{ s.text }}</p>
              @if (s.savings) {
                <ul class="ob-types">
                  <li><span>🎯</span><div><b>Goal Savings</b><small>Set a target amount and deadline</small></div></li>
                  <li><span>💰</span><div><b>Flexible Savings</b><small>Save any amount, no fixed target</small></div></li>
                  <li><span>🌱</span><div><b>General Savings</b><small>Set money aside for future needs</small></div></li>
                </ul>
              }
            </div>
          }

          <div class="ob-footer">
            <div class="ob-dots" role="progressbar" aria-valuemin="1" [attr.aria-valuemax]="total"
                 [attr.aria-valuenow]="index() + 1" [attr.aria-label]="'Step ' + (index() + 1) + ' of ' + total">
              @for (d of dots; track d) {
                <span [class.active]="d === index()"></span>
              }
            </div>
            <span class="ob-count">Step {{ index() + 1 }} of {{ total }}</span>
          </div>

          <div class="ob-actions">
            @if (!isLast()) {
              <button type="button" class="ob-skip" (click)="finish()">Skip</button>
              <button type="button" class="ob-next" (click)="next()">
                Next <ion-icon name="arrow-forward-outline" />
              </button>
            } @else {
              <button type="button" class="ob-next ob-start" (click)="finish()">Get Started</button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class OnboardingComponent {
  protected readonly onboarding = inject(OnboardingService);
  private readonly router = inject(Router);

  protected readonly total = STEPS.length;
  protected readonly dots = STEPS.map((_, i) => i);
  protected readonly index = signal(0);
  protected readonly step = computed(() => STEPS[this.index()]);
  protected readonly isLast = computed(() => this.index() === STEPS.length - 1);
  protected readonly spot = signal<SpotRect | null>(null);
  /** Distance from the viewport bottom to keep the card clear of the tab bar. */
  protected readonly cardBottom = signal(96);

  constructor() {
    addIcons({
      walletOutline, receiptOutline, homeOutline, flagOutline, cashOutline, leafOutline,
      arrowForwardOutline,
    });

    effect(() => {
      if (!this.onboarding.visible()) {
        this.index.set(0);
        this.spot.set(null);
        return;
      }
      this.updateSpot();
    });
  }

  @HostListener('window:resize')
  protected updateSpot(): void {
    const tab = this.step().tab;
    const el = tab ? document.querySelector<HTMLElement>(`ion-tab-button[tab="${tab}"]`) : null;
    if (!el) {
      this.spot.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 4;
    this.cardBottom.set(Math.round(window.innerHeight - r.top + pad + 12));
    this.spot.set({
      top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2,
    });
  }

  /** Advances to the next step, navigating to the screen being introduced. */
  protected next(): void {
    if (this.isLast()) return;
    this.index.update(i => i + 1);
    const route = this.step().route;
    if (route) void this.router.navigateByUrl(route);
    this.updateSpot();
  }

  /** Completes (or skips) the walkthrough and returns the user to Home. */
  protected finish(): void {
    void this.onboarding.finish();
    void this.router.navigateByUrl('/dashboard');
  }
}
