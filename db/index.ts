import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  // Load the Workers binding only when a request needs the database. Keeping
  // this import lazy lets the server bundle be validated in a regular Node
  // process while Cloudflare still resolves the binding at runtime.
  const { env } = await import("cloudflare:workers");

  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
