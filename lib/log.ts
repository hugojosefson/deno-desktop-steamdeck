const URL = Deno.env.get("OPENOBSERVE_URL");
const USER = Deno.env.get("OPENOBSERVE_USER");
const PASSWORD = Deno.env.get("OPENOBSERVE_PASSWORD");

const enabled = !!(URL && USER && PASSWORD);

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
    const auth = btoa(`${USER}:${PASSWORD}`);
    const res = await fetch(`${URL}/api/default/default/_json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

export function setupGlobalErrorHandlers(): void {
  self.addEventListener("error", (event) => {
    logError("uncaught error", event.error ?? event.message).catch(() => {});
  });
  self.addEventListener("unhandledrejection", (event) => {
    logError("unhandled rejection", event.reason).catch(() => {});
  });
}
