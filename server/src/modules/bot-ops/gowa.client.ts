import { z } from "zod";

// Thin client for GoWA (aldinokemal/go-whatsapp-web-multidevice) REST API.
// Responses are parsed leniently — .passthrough() plus optional fields — so
// minor version drift in GoWA never crashes the dashboard; only the fields the
// dashboard actually needs are read.

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_QR_DURATION_SECONDS = 30;

const devicesResponseSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    results: z
      .array(
        z
          .object({
            name: z.string().optional(),
            device: z.string().optional()
          })
          .passthrough()
      )
      .nullish()
  })
  .passthrough();

const loginResponseSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    results: z
      .object({
        qr_duration: z.number().optional(),
        qr_link: z.string().optional()
      })
      .passthrough()
      .nullish()
  })
  .passthrough();

export interface GowaDevice {
  name: string;
  device: string;
}

export interface GowaLoginQr {
  qrLink: string;
  durationSeconds: number;
}

export type GowaResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface GowaClientOptions {
  baseUrl: string;
  basicAuthUser: string;
  basicAuthPassword: string;
  fetchImpl?: typeof fetch;
}

export interface GowaClient {
  getDevices(timeoutMs?: number): Promise<GowaResult<GowaDevice[]>>;
  requestLoginQr(): Promise<GowaResult<GowaLoginQr>>;
  fetchQrPngBase64(qrLink: string): Promise<GowaResult<string>>;
  logout(): Promise<GowaResult<null>>;
  reconnect(): Promise<GowaResult<null>>;
}

export function createGowaClient(options: GowaClientOptions): GowaClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const authorization = `Basic ${Buffer.from(
    `${options.basicAuthUser}:${options.basicAuthPassword}`
  ).toString("base64")}`;

  async function request(url: string, timeoutMs: number): Promise<GowaResult<Response>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers: { authorization },
        signal: controller.signal
      });

      if (!response.ok) {
        return { ok: false, error: `GoWA responded with HTTP ${response.status}` };
      }

      return { ok: true, value: response };
    } catch (error) {
      return { ok: false, error: describeFetchError(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestJson(path: string, timeoutMs: number): Promise<GowaResult<unknown>> {
    const result = await request(`${baseUrl}${path}`, timeoutMs);
    if (!result.ok) {
      return result;
    }

    try {
      const body: unknown = await result.value.json();
      return { ok: true, value: body };
    } catch {
      return { ok: false, error: "GoWA returned a non-JSON response" };
    }
  }

  return {
    async getDevices(timeoutMs = DEFAULT_TIMEOUT_MS) {
      const result = await requestJson("/app/devices", timeoutMs);
      if (!result.ok) {
        return result;
      }

      const parsed = devicesResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected GoWA devices response" };
      }

      const devices = (parsed.data.results ?? []).map((entry) => ({
        name: entry.name ?? "",
        device: entry.device ?? ""
      }));

      return { ok: true, value: devices };
    },

    async requestLoginQr() {
      const result = await requestJson("/app/login", DEFAULT_TIMEOUT_MS);
      if (!result.ok) {
        return result;
      }

      const parsed = loginResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected GoWA login response" };
      }

      const results = parsed.data.results;
      if (!results || results.qr_link === undefined || results.qr_link === "") {
        return { ok: false, error: "GoWA login response did not include a QR link" };
      }

      return {
        ok: true,
        value: {
          qrLink: results.qr_link,
          durationSeconds: results.qr_duration ?? DEFAULT_QR_DURATION_SECONDS
        }
      };
    },

    async fetchQrPngBase64(qrLink) {
      const result = await request(qrLink, DEFAULT_TIMEOUT_MS);
      if (!result.ok) {
        return result;
      }

      try {
        const bytes = await result.value.arrayBuffer();
        return { ok: true, value: Buffer.from(bytes).toString("base64") };
      } catch {
        return { ok: false, error: "Failed to read the QR image from GoWA" };
      }
    },

    async logout() {
      const result = await requestJson("/app/logout", DEFAULT_TIMEOUT_MS);
      return result.ok ? { ok: true, value: null } : result;
    },

    async reconnect() {
      const result = await requestJson("/app/reconnect", DEFAULT_TIMEOUT_MS);
      return result.ok ? { ok: true, value: null } : result;
    }
  };
}

function describeFetchError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "GoWA request failed";
  }

  // AbortError is a DOMException, which is not an instanceof Error in Node,
  // so inspect the shape instead of the prototype chain.
  const { name, message, cause } = error as { name?: unknown; message?: unknown; cause?: unknown };
  if (name === "AbortError" || name === "TimeoutError") {
    return "GoWA request timed out";
  }

  const causeMessage =
    typeof cause === "object" && cause !== null
      ? (cause as { message?: unknown }).message
      : undefined;
  const detail =
    typeof causeMessage === "string" && causeMessage !== ""
      ? causeMessage
      : typeof message === "string"
        ? message
        : "";

  return detail === "" ? "GoWA request failed" : `GoWA request failed: ${detail}`;
}
