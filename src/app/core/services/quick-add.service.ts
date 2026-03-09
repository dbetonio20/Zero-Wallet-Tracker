import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Fired when the user taps the quick-add FAB anywhere in the app. */
@Injectable({ providedIn: 'root' })
export class QuickAddService {
  private trigger$ = new Subject<void>();

  /** Observable that expenses component subscribes to. */
  readonly onTrigger$ = this.trigger$.asObservable();

  trigger(): void {
    this.trigger$.next();
  }
}
