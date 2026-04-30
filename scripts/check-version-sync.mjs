import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const serverJson = JSON.parse(fs.readFileSync("server.json", "utf8"));

const packageVersion = packageJson.version;
const serverVersion = serverJson.version;
const packageEntryVersion = serverJson.packages?.[0]?.version;

if (!packageVersion || !serverVersion || !packageEntryVersion) {
  console.error("Missing required version fields in package.json or server.json.");
  process.exit(1);
}

if (packageVersion !== serverVersion || serverVersion !== packageEntryVersion) {
  console.error("Version mismatch detected:");
  console.error(`- package.json version: ${packageVersion}`);
  console.error(`- server.json version: ${serverVersion}`);
  console.error(`- server.json packages[0].version: ${packageEntryVersion}`);
  process.exit(1);
}

console.log(`Versions in sync: ${packageVersion}`);
