import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider,
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import { firebaseAuth } from '../config/firebase.config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _currentUser = signal<FirebaseUser | null>(null);

  /** Read-only signal — current Firebase user, or null if signed out. */
  readonly currentUser = this._currentUser.asReadonly();

  /** Computed signal — true when a user is signed in. */
  readonly isLoggedIn = computed(() => this._currentUser() !== null);

  /** Observable alias for async-pipe consumers. */
  readonly currentUser$ = toObservable(this._currentUser);

  /**
   * Called once at app startup via APP_INITIALIZER.
   * Resolves after Firebase restores the persisted auth session (or confirms no session).
   * The listener is kept alive (NOT unsubscribed) so the signal stays accurate
   * for the entire app lifetime — e.g. token expiry, sign-out from another tab.
   */
  init(): Promise<void> {
    return new Promise(resolve => {
      let resolved = false;
      onAuthStateChanged(firebaseAuth, user => {
        this._currentUser.set(user);
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
  }

  /**
   * Opens the native Android Google account picker and signs the user in.
   * The credential returned by the Capacitor plugin is forwarded to the
   * Firebase Web SDK so that Firestore (and onAuthStateChanged) work correctly.
   * Throws a user-friendly error if the sign-in was cancelled or credentials
   * were not returned by the native plugin.
   */
  async signInWithGoogle(): Promise<void> {
    const result = await FirebaseAuthentication.signInWithGoogle();

    if (!result.credential?.idToken) {
      throw new Error('Sign-in was cancelled or no credential was returned.');
    }

    const credential = GoogleAuthProvider.credential(
      result.credential.idToken,
      result.credential.accessToken
    );
    // signInWithCredential triggers onAuthStateChanged which updates the signal.
    await signInWithCredential(firebaseAuth, credential);
    // No manual signal set needed — onAuthStateChanged handles it.
  }

  /**
   * Signs out from both the Capacitor native Firebase SDK and the Web SDK.
   * Clears the currentUser signal.
   */
  async signOut(): Promise<void> {
    await FirebaseAuthentication.signOut();
    await firebaseSignOut(firebaseAuth);
    this._currentUser.set(null);
  }
}
