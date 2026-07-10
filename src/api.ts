import https from "node:https";
import { MAILGUN_API_KEY, MAILGUN_API_HOSTNAME } from "./config.js";

export class MailgunApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly apiMessage?: string,
  ) {
    super(message);
    this.name = "MailgunApiError";
  }
}

export async function makeMailgunRequest(
  method: string,
  requestPath: string,
  data: Record<string, unknown> | null = null,
  contentType: string = "application/x-www-form-urlencoded",
  // Optional per-request timeout in milliseconds. When omitted, behavior is
  // unchanged for existing callers (Node's default socket behavior, no timeout).
  // This is a request-level timeout only; it does not add retries and is
  // independent of any higher-level polling deadline.
  timeoutMs?: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanPath = requestPath.startsWith("/") ? requestPath.substring(1) : requestPath;

    const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64");
    const options: https.RequestOptions = {
      hostname: MAILGUN_API_HOSTNAME,
      path: `/${cleanPath}`,
      method: method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": contentType,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk: Buffer) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedData = JSON.parse(responseData);
          if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            const apiMsg = parsedData.message || parsedData.Reason || responseData;
            reject(new MailgunApiError(apiMsg, res.statusCode ?? 0, apiMsg));
          }
        } catch (e) {
          reject(
            new MailgunApiError(
              `Failed to parse response: ${(e as Error).message}`,
              res.statusCode ?? 0,
            ),
          );
        }
      });
    });

    req.on("error", (error: Error) => {
      reject(error);
    });

    if (timeoutMs !== undefined && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        // Abort the in-flight request; the resulting error rejects the promise.
        // No retry is attempted.
        req.destroy(new MailgunApiError(`Request timed out after ${timeoutMs}ms`, 0));
      });
    }

    if (data && method !== "GET") {
      if (contentType === "application/json") {
        req.write(JSON.stringify(data));
      } else {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(key, String(item));
            }
          } else if (value !== undefined && value !== null) {
            formData.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
          }
        }
        req.write(formData.toString());
      }
    }

    req.end();
  });
}
