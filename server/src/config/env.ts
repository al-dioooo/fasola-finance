import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3100),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "Must be a postgres:// connection string")
    .default("postgres://postgres@localhost:5432/fasola"),

  ADMIN_PASSWORD: z.string().min(12, "Use at least 12 characters"),
  SESSION_SECRET: z.string().min(32, "Generate with `openssl rand -hex 32`"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  GOWA_BASE_URL: z.string().url().default("http://127.0.0.1:3001"),
  GOWA_BASIC_AUTH_USER: z.string().default(""),
  GOWA_BASIC_AUTH_PASSWORD: z.string().default(""),

  BOT_BASE_URL: z.string().url().default("http://127.0.0.1:3010"),
  // Shared secret sent as a Bearer token to the bot's /internal/gofood/*
  // endpoints. Must match the bot's INTERNAL_API_TOKEN.
  BOT_INTERNAL_TOKEN: z.string().default(""),

  // Product images for the GoFood catalog are uploaded here and served
  // publicly at PUBLIC_BASE_URL/uploads/<file>. In production PUBLIC_BASE_URL
  // must be the dashboard's public https origin so GoFood can fetch the images.
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3100"),
  UPLOADS_DIR: z.string().default("./data/uploads")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}
