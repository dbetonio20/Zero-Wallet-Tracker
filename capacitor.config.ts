import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.salapi.tracker',
  appName: 'Salapi',
  webDir: 'dist/salapi/browser',
  plugins: {
    FirebaseAuthentication: {
      // skipNativeAuth: true means the plugin only fetches the Google credential
      // (via Google Play Services) without calling Firebase Auth natively.
      // Our Web SDK signInWithCredential() call handles the actual Firebase sign-in,
      // which is required for Firestore JS SDK access.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
