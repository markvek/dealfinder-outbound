import { tickSchedules } from "../src/server/automation/schedules";
import { workerTick } from "../src/server/automation/worker";
const once = process.argv.includes("--once"),
  schedulerOnly = process.argv.includes("--scheduler-only"),
  workerOnly = process.argv.includes("--worker-only");
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
async function loop(work: () => unknown | Promise<unknown>) {
  do {
    try {
      await work();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Automation tick failed",
      );
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopped);
}
console.log(
  `DealFinder ${schedulerOnly ? "scheduler" : workerOnly ? "worker" : "scheduler + worker"} started.`,
);
Promise.all([
  !workerOnly &&
    loop(() => {
      const result = tickSchedules();
      if (result.enqueued || result.errors)
        console.log("Schedule tick", result);
    }),
  !schedulerOnly && loop(workerTick),
]).catch(() => {
  process.exitCode = 1;
});
