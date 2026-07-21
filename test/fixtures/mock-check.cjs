// Test/smoke command for the mock project.
//   default : pass iff build/<STRIDE_TASK_ID>.txt exists and contains "ok"
//   --smoke : pass unless a BREAK_SMOKE file exists (simulated regression)
const fs = require("fs");

if (process.argv.includes("--smoke")) {
  process.exit(fs.existsSync("BREAK_SMOKE") ? 1 : 0);
}

const id = process.env.STRIDE_TASK_ID || "";
const f = `build/${id}.txt`;
if (!fs.existsSync(f)) {
  console.error(`missing ${f}`);
  process.exit(1);
}
process.exit(fs.readFileSync(f, "utf8") === "ok" ? 0 : 1);
