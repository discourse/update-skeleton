#!/usr/bin/env node
import { parseArgs } from "node:util";
import { update } from "../src/update.js";

try {
  const { values } = parseArgs({
    options: { help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(
      "Run update-skeleton from a theme or plugin root to replace scaffolding and install dependencies."
    );
  } else {
    await update();
  }
} catch (error) {
  console.error(error.message);
  console.error("Fix the error and rerun. Files already written are kept.");
  process.exitCode = 1;
}
