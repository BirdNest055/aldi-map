/**
 * DEPRECATED: This file is kept for backwards compatibility.
 * The app now uses SupabaseStoreProvider which reads from Supabase.
 * 
 * The getStoreProvider() function now returns a SupabaseStoreProvider.
 * stores.json is no longer the source of truth.
 */
export { getStoreProvider } from "./supabase-provider";
export { SupabaseStoreProvider as JsonStoreProvider } from "./supabase-provider";
