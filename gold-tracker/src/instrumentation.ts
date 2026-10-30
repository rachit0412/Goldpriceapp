export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { evaluateAlerts } = await import("./lib/alerts");
    const { config } = await import("./lib/market");
    const { collectIndianHistory } = await import("./lib/dealers");
    const { indianDailyHistory } = await import("./lib/india-history");
    const runtime = globalThis as typeof globalThis & {
      goldMonitor?: ReturnType<typeof setInterval>;
      indianMonitor?: ReturnType<typeof setInterval>;
    };
    if (!runtime.indianMonitor) {
      let collecting = false;
      const collect = async () => {
        if (collecting) return;
        collecting = true;
        try {
          await Promise.all([collectIndianHistory(), indianDailyHistory(7)]);
        } catch (error) {
          console.error("Indian history collector:", error instanceof Error ? error.message : "failure");
        } finally {
          collecting = false;
        }
      };
      runtime.indianMonitor = setInterval(collect, 60000);
      runtime.indianMonitor.unref();
      void collect();
    }
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
