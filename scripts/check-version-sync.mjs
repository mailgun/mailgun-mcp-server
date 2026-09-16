import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const serverJson = JSON.parse(fs.readFileSync("server.json", "utf8"));
const versionTs = fs.readFileSync("src/version.ts", "utf8");

const packageName = packageJson.name;
const packageVersion = packageJson.version;
const serverVersion = serverJson.version;
const packageEntryVersion = serverJson.packages?.[0]?.version;
const versionTsName = versionTs.match(/export const PACKAGE_NAME = "([^"]+)";/)?.[1];
const versionTsVersion = versionTs.match(/export const PACKAGE_VERSION = "([^"]+)";/)?.[1];

if (
  !packageName ||
  !packageVersion ||
  !serverVersion ||
  !packageEntryVersion ||
  !versionTsName ||
  !versionTsVersion
) {
  console.error("Missing required version fields in package.json, server.json, or src/version.ts.");
  process.exit(1);
}

if (
  packageName !== versionTsName ||
  packageVersion !== serverVersion ||
  serverVersion !== packageEntryVersion ||
  packageVersion !== versionTsVersion
) {
  console.error("Version mismatch detected:");
  console.error(`- package.json name: ${packageName}`);
  console.error(`- package.json version: ${packageVersion}`);
  console.error(`- server.json version: ${serverVersion}`);
  console.error(`- server.json packages[0].version: ${packageEntryVersion}`);
  console.error(`- src/version.ts PACKAGE_NAME: ${versionTsName}`);
  console.error(`- src/version.ts PACKAGE_VERSION: ${versionTsVersion}`);
  process.exit(1);
}

console.log(`Versions in sync: ${packageName}/${packageVersion}`);
