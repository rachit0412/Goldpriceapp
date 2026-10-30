export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { evaluateAlerts } = await import("./lib/alerts");
    const { config } = await import("./lib/market");
    const runtime = globalThis as typeof globalThis & {
      goldMonitor?: ReturnType<typeof setInterval>;
    };
    if (!runtime.goldMonitor) {
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          await evaluateAlerts();
        } catch (error) {
          console.error(
            "Gold monitor:",
            error instanceof Error ? error.message : "failure",
          );
        } finally {
          running = false;
        }
      };
      runtime.goldMonitor = setInterval(tick, config.refreshSeconds * 1000);
      runtime.goldMonitor.unref();
      void tick();
    }
  }
}
