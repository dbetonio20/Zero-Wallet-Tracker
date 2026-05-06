import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

import { environment } from '../../../environments/environment';

/** Singleton Firebase app instance. */
export const firebaseApp = initializeApp(environment.firebase);

/** Firebase Auth instance (Web SDK). */
export const firebaseAuth = getAuth(firebaseApp);

/**
 * Firestore with offline persistence enabled.
 * Uses cache-first reads (getDoc) so the app works immediately on startup.
 * Firestore will sync from the server in the background once connected.
 */
export const firestoreDb = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache(),
});
