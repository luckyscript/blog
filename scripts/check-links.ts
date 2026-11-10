import { runLinkHealthChecks } from "../src/lib/server/link-health-worker";
import { closeDatabase } from "../src/db";
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
try {
  console.log(
    JSON.stringify({
      event: "link_health_check",
      ...(await runLinkHealthChecks({
        force: process.argv.includes("--force"),
        signal: controller.signal,
      })),
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "link_health_failed",
      reason: controller.signal.aborted ? "interrupted" : "check_failed",
    })
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
