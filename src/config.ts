import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
export const MAILGUN_API_REGION = (process.env.MAILGUN_API_REGION || "us").toLowerCase();
export const MAILGUN_API_HOSTNAME =
  process.env.MAILGUN_API_HOSTNAME ||
  (MAILGUN_API_REGION === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net");
export const OPENAPI_YAML = path.resolve(__dirname, "openapi.yaml");
