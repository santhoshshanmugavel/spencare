import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// SecureStore adapter for Supabase session persistence.
// expo-secure-store keeps tokens in the Android Keystore / iOS Keychain —
// never in AsyncStorage or other unencrypted storage.
const ExpoSecureStoreAdapter = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// The mobile Supabase client is used only for read-only operations that benefit
// from the anon key (e.g. future realtime subscriptions). Auth is handled
// entirely via the /api/mobile/* REST endpoints — the client does NOT manage
// the session itself.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
