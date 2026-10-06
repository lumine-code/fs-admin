const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const EventEmitter = require("node:events");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const buildSource = fs.readFileSync(path.join(__dirname, "..", "script", "build.js"), "utf8");

function loadForPlatform(platform, childProcess, binding) {
  const module = { exports: {} };
  const requireDependency = (name) => {
    if (name === "./build/Release/fs_admin.node") {
      if (!binding) throw new Error("No native binary is installed");
      return binding;
    }
    if (name === "child_process") return childProcess;
    return require(name);
  };
  vm.runInNewContext(source, {
    module,
    require: requireDependency,
    process: { platform, nextTick: process.nextTick },
  });
  return module.exports;
}

describe("platform requirements", () => {
  it("loads Linux and writes through pkexec without a native binary", () => {
    const child = new EventEmitter();
    child.stdin = { write: jasmine.createSpy("write"), end: jasmine.createSpy("end") };
    const childProcess = {
      spawnSync: jasmine.createSpy("spawnSync").and.returnValue({ status: 0 }),
      spawn: jasmine.createSpy("spawn").and.returnValue(child),
    };
    const fsAdmin = loadForPlatform("linux", childProcess);
    const stream = fsAdmin.createWriteStream("/etc/example");
    const finish = jasmine.createSpy("finish");
    stream.write("content", "utf8");
    stream.end(finish);
    child.emit("exit", 0);

    expect(childProcess.spawnSync).toHaveBeenCalledWith("/usr/bin/pkexec", ["/bin/dd"]);
    expect(childProcess.spawn).toHaveBeenCalledWith("/usr/bin/pkexec", [
      "/bin/dd",
      "of=/etc/example",
    ]);
    expect(child.stdin.write).toHaveBeenCalledWith("content", "utf8", undefined);
    expect(child.stdin.end).toHaveBeenCalled();
    expect(finish).toHaveBeenCalled();
    fsAdmin.clearAuthorizationCache();
    expect(childProcess.spawnSync).toHaveBeenCalledWith("/bin/pkcheck", ["--revoke-temp"]);
  });

  for (const platform of ["darwin", "win32"]) {
    it(`still requires the native binary on ${platform}`, () => {
      expect(() => loadForPlatform(platform, {})).toThrowError("No native binary is installed");
      const binding = {
        spawnAsAdmin: jasmine.createSpy("spawnAsAdmin"),
      };
      const fsAdmin = loadForPlatform(platform, {}, binding);
      const callback = jasmine.createSpy("callback");
      fsAdmin.symlink("target", "link", callback);
      expect(binding.spawnAsAdmin).toHaveBeenCalled();
    });
  }

  it("skips the native toolchain when installing or building on Linux", () => {
    const requireDependency = jasmine.createSpy("require");
    vm.runInNewContext(buildSource, { require: requireDependency, process: { platform: "linux" } });
    expect(requireDependency).not.toHaveBeenCalled();
  });

  for (const platform of ["darwin", "win32"]) {
    it(`builds the native addon on ${platform} and preserves a failed exit status`, () => {
      const spawnSync = jasmine.createSpy("spawnSync").and.returnValue({ status: 7 });
      const process = { platform };
      vm.runInNewContext(buildSource, { require: () => ({ spawnSync }), process });
      expect(spawnSync).toHaveBeenCalledWith("node-gyp rebuild", { stdio: "inherit", shell: true });
      expect(process.exitCode).toBe(7);
    });
  }
});
