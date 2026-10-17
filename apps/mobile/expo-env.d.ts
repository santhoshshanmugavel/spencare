/// <reference types="expo/types/index" />

// Committed (not generated) — provides type declarations for
// process.env.EXPO_PUBLIC_* variables used in this workspace.
// Required by the tsconfig.json include list.

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_API_URL: string | undefined;
    readonly EXPO_PUBLIC_SUPABASE_URL: string | undefined;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY: string | undefined;
  }
}

declare var process: {
  env: NodeJS.ProcessEnv;
};
