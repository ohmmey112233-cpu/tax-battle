import { readFile, writeFile } from "node:fs/promises";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const databaseName = "tax-battle-db";

if (!accountId || !apiToken) {
  throw new Error(
    "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.",
  );
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function cloudflare(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).join(", ");
    throw new Error(message || `Cloudflare request failed (${response.status}).`);
  }

  return payload.result;
}

const databases = await cloudflare(
  `/d1/database?name=${encodeURIComponent(databaseName)}`,
);
let database = databases.find((item) => item.name === databaseName);

if (!database) {
  database = await cloudflare("/d1/database", {
    method: "POST",
    body: JSON.stringify({ name: databaseName }),
  });
  console.log(`Created D1 database ${databaseName}.`);
} else {
  console.log(`Using existing D1 database ${databaseName}.`);
}

const databaseId = database.uuid ?? database.id;
if (!databaseId) throw new Error("Cloudflare did not return a D1 database ID.");

const baseConfig = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
baseConfig.d1_databases = [
  {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "drizzle",
  },
];

await writeFile(
  "wrangler.deploy.jsonc",
  `${JSON.stringify(baseConfig, null, 2)}\n`,
  "utf8",
);
console.log("Prepared Cloudflare deployment configuration.");
