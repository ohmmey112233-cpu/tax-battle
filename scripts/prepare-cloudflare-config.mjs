import { readFile, writeFile } from "node:fs/promises";

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const databaseName = "tax-battle-db";

if (!apiToken) {
  throw new Error(
    "CLOUDFLARE_API_TOKEN is required.",
  );
}

const apiRoot = "https://api.cloudflare.com/client/v4";
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function request(url, init = {}) {
  const response = await fetch(url, {
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

if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
  const accounts = await request(`${apiRoot}/accounts?per_page=50`);
  if (accounts.length !== 1) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID must be the 32-character account ID when the token can access more than one account.",
    );
  }
  accountId = accounts[0].id;
  console.log("Resolved the Cloudflare account from the API token.");
}

const apiBase = `${apiRoot}/accounts/${accountId}`;
const cloudflare = (path, init) => request(`${apiBase}${path}`, init);

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
