import ora from "ora";
import { autoFix } from "../ship/fixer.js";
import { brand, receipt, warn, dim } from "../ui/brand.js";

export async function fix(): Promise<void> {
  const spinner = ora({
    text: "fixing...",
    color: "gray",
  }).start();

  const result = await autoFix(process.cwd());

  spinner.stop();

  console.log("");

  if (result.fixed === 0 && result.skipped === 0) {
    receipt("nothing to fix. already clean.");
  } else {
    if (result.fixed > 0) {
      receipt(`${result.fixed} issues fixed.`);
      for (const action of result.actions) {
        console.log(brand.ACID(`  ✓ ${action}`));
      }
    }
    if (result.skipped > 0) {
      warn(`${result.skipped} issues need manual fix.`);
    }
  }

  dim("run nc check to see updated score.");
  console.log("");
}
