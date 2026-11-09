import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const OPENAPI_YAML = path.resolve(__dirname, "openapi.yaml");

export interface MailgunConfig {
  readonly apiKey: string;
  readonly hostname: string;
}

// The region only picks the hostname; MAILGUN_API_HOSTNAME overrides both.
export function resolveApiHostname(env: NodeJS.ProcessEnv): string {
  const region = (env.MAILGUN_API_REGION || "us").toLowerCase();
  return env.MAILGUN_API_HOSTNAME || (region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net");
}

// LOCAL: one key for the whole process, read from the environment once at startup.
export function localConfig(env: NodeJS.ProcessEnv): MailgunConfig | undefined {
  const apiKey = env.MAILGUN_API_KEY;
  if (!apiKey) return undefined;
  return { apiKey, hostname: resolveApiHostname(env) };
}

// HOSTED: the caller's key on the deployment's fixed hostname, built per request.
export function hostedConfig(apiKey: string, hostname: string): MailgunConfig {
  if (!apiKey) {
    throw new Error("A Mailgun API key is required.");
  }
  return { apiKey, hostname };
}
