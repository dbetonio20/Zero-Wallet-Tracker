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
   * This ensures the auth guard has accurate state before any route activates.
   */
  init(): Promise<void> {
    return new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, user => {
        this._currentUser.set(user);
        unsubscribe(); // only needed for the initial resolution
        resolve();
      });
    });
  }

  /**
   * Opens the native Android Google account picker and signs the user in.
   * The credential returned by the Capacitor plugin is forwarded to the
   * Firebase Web SDK so that Firestore (and onAuthStateChanged) work correctly.
   */
  async signInWithGoogle(): Promise<void> {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const credential = GoogleAuthProvider.credential(
      result.credential?.idToken,
      result.credential?.accessToken
    );
    const userCredential = await signInWithCredential(firebaseAuth, credential);
    this._currentUser.set(userCredential.user);
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
