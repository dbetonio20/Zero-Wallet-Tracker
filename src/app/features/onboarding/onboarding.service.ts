import { Injectable, inject, signal } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly prefs = inject(PreferencesService);
  private readonly _visible = signal(false);
  /** True while the walkthrough overlay is displayed. */
  readonly visible = this._visible.asReadonly();

  /** Shows the walkthrough automatically if the user has not seen it yet. */
  async showIfFirstTime(): Promise<void> {
    try {
      if (!(await this.prefs.isOnboardingDone())) this._visible.set(true);
    } catch {
      // Storage unavailable: skip the tour rather than risk showing it on every launch.
    }
  }

  /** Opens the walkthrough on demand (e.g. from Settings). */
  open(): void {
    this._visible.set(true);
  }

  /** Closes the walkthrough and remembers that it was completed or skipped. */
  async finish(): Promise<void> {
    this._visible.set(false);
    try {
      await this.prefs.setOnboardingDone(true);
    } catch {
      // The tour is already closed; it will simply show again next launch.
    }
  }
}
