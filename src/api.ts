import https from "node:https";
import { MAILGUN_API_KEY, MAILGUN_API_HOSTNAME } from "./config.js";

export async function makeMailgunRequest(
  method: string,
  requestPath: string,
  data: Record<string, unknown> | null = null,
  contentType: string = "application/x-www-form-urlencoded",
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
            reject(new Error(`Mailgun API error: ${parsedData.message || responseData}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${(e as Error).message}`));
        }
      });
    });

    req.on("error", (error: Error) => {
      reject(error);
    });

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
