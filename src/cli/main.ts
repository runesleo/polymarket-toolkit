import { runActivity } from "./commands/activity.ts";
import { runBrier } from "./commands/brier.ts";
import { runLb } from "./commands/lb.ts";
import { runLimits } from "./commands/limits.ts";
import { runMarkets } from "./commands/markets.ts";
import { runPnlCheck } from "./commands/pnl-check.ts";
import { runProfile } from "./commands/profile.ts";
import { runRedeem } from "./commands/redeem.ts";
import { runScan } from "./commands/scan.ts";
import { runUpdown } from "./commands/updown.ts";
import { runV2Check } from "./commands/v2-check.ts";
import { usage } from "./util.ts";

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  switch (cmd) {
    case "profile":
      await runProfile(rest);
      break;
    case "redeem":
      await runRedeem(rest);
      break;
    case "activity":
      await runActivity(rest);
      break;
    case "brier":
      await runBrier(rest);
      break;
    case "markets":
      await runMarkets(rest);
      break;
    case "scan":
      await runScan(rest);
      break;
    case "updown":
      await runUpdown(rest);
      break;
    case "v2-check":
      await runV2Check(rest);
      break;
    case "lb":
      await runLb(rest);
      break;
    case "pnl-check":
      await runPnlCheck(rest);
      break;
    case "limits":
      await runLimits(rest);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
