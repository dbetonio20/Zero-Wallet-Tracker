import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

import { environment } from '../../../environments/environment';

/** Singleton Firebase app instance. */
export const firebaseApp = initializeApp(environment.firebase);

/** Firebase Auth instance (Web SDK). */
export const firebaseAuth = getAuth(firebaseApp);

/**
 * Firestore instance with offline persistence enabled.
 * On Capacitor Android (single-tab WebView), persistentLocalCache is appropriate.
 */
export const firestoreDb = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache(),
});
