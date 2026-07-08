import { OPENOBSERVE_TOKEN, OPENOBSERVE_URL } from "../generated/env.ts";

const URL = OPENOBSERVE_URL;
const TOKEN = OPENOBSERVE_TOKEN;

const enabled = !!(URL && TOKEN);
console.error(
  `[log] init: enabled=${enabled} url=${URL ? "set" : "unset"} token=${
    TOKEN ? "set" : "unset"
  }`,
);

function fallback(level: string, message: string, data: unknown) {
  if (level === "error") {
    console.error(`[${level}] ${message}`, data);
  } else {
    console.log(`[${level}] ${message}`, data);
  }
}

export async function log(
  level: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!enabled) {
    fallback(level, message, data);
    return;
  }

  const body = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers.Authorization = `Basic ${btoa(`:${TOKEN}`)}`;
    const res = await fetch(`${URL}/api/default/default/_json`, {
      method: "POST",
      headers,
      body: JSON.stringify([body]),
    });
    if (!res.ok) {
      console.error(
        "log send failed:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.error("log send error:", e);
  }
}

export async function logError(
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): Promise<void> {
  await log("error", message, {
    ...data,
    error: error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : String(error),
  });
}

async function sendToOpenObserve(
  level: string,
  msg: string,
): Promise<void> {
  if (!enabled) return;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers.Authorization = `Basic ${btoa(`:${TOKEN}`)}`;
    const body = {
      timestamp: new Date().toISOString(),
      level,
      message: msg,
    };
    await fetch(`${URL}/api/default/default/_json`, {
      method: "POST",
      headers,
      body: JSON.stringify([body]),
    });
  } catch {
    // silently ignore — don't recurse
  }
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  origLog(...args);
  sendToOpenObserve("info", args.map((a) => String(a)).join(" "));
};
console.warn = (...args: unknown[]) => {
  origWarn(...args);
  sendToOpenObserve("warn", args.map((a) => String(a)).join(" "));
};
console.error = (...args: unknown[]) => {
  origError(...args);
  sendToOpenObserve("error", args.map((a) => String(a)).join(" "));
};

export function setupGlobalErrorHandlers(): void {
  self.addEventListener("error", (event) => {
    logError("uncaught error", event.error ?? event.message).catch(() => {});
  });
  self.addEventListener("unhandledrejection", (event) => {
    logError("unhandled rejection", event.reason).catch(() => {});
  });
}
