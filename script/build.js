// Linux operations use pkexec directly and do not need a native addon.
if (process.platform !== "linux") {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("node-gyp rebuild", { stdio: "inherit", shell: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
