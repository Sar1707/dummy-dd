/**
 * Typed access to Vite env vars. Values are baked in at BUILD time from
 * `env/.env.<mode>` — changing them requires a rebuild + redeploy.
 */
export const env = {
  API_BASE_URL: import.meta.env.VITE_API_URL ?? "",
  APP_ENV: import.meta.env.VITE_APP_ENV ?? "unknown",
} as const;
