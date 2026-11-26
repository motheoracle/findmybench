import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — wraps the Vite build (`dist/`) into native iOS/Android shells.
 *
 * First-time setup:
 *   npm run cap:add:ios        # requires Xcode (macOS)
 *   npm run cap:add:android    # requires Android Studio
 * Then on every change:
 *   npm run cap:sync
 *
 * See README.md → "Native wrapping" for the permission strings
 * (location, camera, photo library) to add to Info.plist / AndroidManifest.xml.
 */
const config: CapacitorConfig = {
  appId: 'uk.findmybench.app',
  appName: 'FindMyBench',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // For live-reload on a device during development, uncomment and set your LAN IP:
    // url: 'http://192.168.1.50:5173',
    // cleartext: true,
  },
  ios: {
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
