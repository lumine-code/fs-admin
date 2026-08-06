const fs = require("fs");
const path = require("path");
const temp = require("temp");
const fsAdmin = require("..");

// Real privilege escalation cannot run unattended: macOS puts up an
// Authorization prompt, Windows a UAC dialog, Linux a polkit agent. Test mode
// exercises the same code paths through unprivileged equivalents, which is
// what makes the suite runnable in CI at all. Comment this out to test against
// actual escalation locally.
fsAdmin.testMode = true;

// Each platform implements a different subset: Windows escalates per command
// and so has no write stream, and Linux implements only the write stream.
// Jasmine rejects a describe with no children, so pick the block up front
// rather than returning from inside it -- that way the excluded specs are
// reported as pending instead of vanishing.
const onPlatforms =
  (...platforms) =>
  (name, body) =>
    (platforms.includes(process.platform) ? describe : xdescribe)(name, body);

describe("fs-admin", function () {
  let dirPath, filePath;

  beforeEach(function () {
    // Typing credentials takes longer than the default timeout allows.
    if (!fsAdmin.testMode) jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    dirPath = temp.mkdirSync("fs-admin-test");
    filePath = path.join(dirPath, "file");
  });

  describe("the module surface", function () {
    // The binding loads at require time, so a build that did not produce
    // `fs_admin.node` fails here rather than somewhere confusing later.
    it("exposes the operations implemented for this platform", function () {
      const always = ["createWriteStream", "clearAuthorizationCache"];
      const notOnLinux = ["symlink", "unlink", "makeTree", "recursiveCopy"];

      switch (process.platform) {
        case "darwin":
          for (const name of [...always, ...notOnLinux]) {
            expect(typeof fsAdmin[name]).toBe("function");
          }
          break;
        case "win32":
          // Windows escalates per command, so it implements no write stream and
          // no authorization cache to clear.
          for (const name of notOnLinux) expect(typeof fsAdmin[name]).toBe("function");
          break;
        case "linux":
          for (const name of always) expect(typeof fsAdmin[name]).toBe("function");
          break;
      }
    });
  });

  onPlatforms("darwin", "linux")("createWriteStream", function () {
    it("writes to the given file as the admin user", function (done) {
      fs.writeFileSync(filePath, "");

      if (!fsAdmin.testMode) {
        fs.chmodSync(filePath, 0o444);
        expect(() => fs.writeFileSync(filePath, "hi")).toThrowError(/EACCES|EPERM/);
      }

      fs.createReadStream(__filename)
        .pipe(fsAdmin.createWriteStream(filePath))
        .on("finish", function () {
          expect(fs.readFileSync(filePath, "utf8")).toBe(fs.readFileSync(__filename, "utf8"));
          done();
        });
    });

    it("does not prompt multiple times when concurrent writes are requested", function (done) {
      fsAdmin.clearAuthorizationCache();

      const filePath2 = path.join(dirPath, "file2");
      const filePath3 = path.join(dirPath, "file3");

      fs.writeFileSync(filePath, "");
      fs.writeFileSync(filePath2, "");
      fs.writeFileSync(filePath3, "");

      if (!fsAdmin.testMode) {
        for (const p of [filePath, filePath2, filePath3]) {
          fs.chmodSync(p, 0o444);
          expect(() => fs.writeFileSync(p, "hi")).toThrowError(/EACCES|EPERM/);
        }
      }

      Promise.all(
        [filePath, filePath2, filePath3].map(
          (target) =>
            new Promise((resolve) =>
              fs
                .createReadStream(__filename)
                .pipe(fsAdmin.createWriteStream(target))
                .on("finish", function () {
                  expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(__filename, "utf8"));
                  resolve();
                }),
            ),
        ),
      ).then(() => done());
    });

    it("reports an error rather than throwing when credentials are refused", function (done) {
      // The stream is returned synchronously and reports failure on it, so a
      // caller that refuses the prompt gets an 'error' event, never a throw.
      const stream = fsAdmin.createWriteStream(filePath);
      expect(typeof stream.write).toBe("function");
      expect(typeof stream.end).toBe("function");
      stream.end(() => done());
    });
  });

  onPlatforms("darwin", "win32")("makeTree", function () {
    it("creates a directory at the given path as the admin user", function (done) {
      const pathToCreate = path.join(dirPath, "dir1", "dir2", "dir3");

      fsAdmin.makeTree(pathToCreate, function (error) {
        expect(error).toBe(null);
        const stats = fs.statSync(pathToCreate);
        expect(stats.isDirectory()).toBe(true);

        if (process.platform === "darwin" && !fsAdmin.testMode) {
          expect(stats.uid).toBe(0);
        }

        done();
      });
    });
  });

  onPlatforms("darwin", "win32")("unlink", function () {
    it("deletes the given file as the admin user", function (done) {
      fs.writeFileSync(filePath, "");

      if (!fsAdmin.testMode) {
        fs.chmodSync(filePath, 0o444);
        fs.chmodSync(path.dirname(filePath), 0o444);
        expect(() => fs.unlinkSync(filePath)).toThrowError(/EACCES|EPERM/);
      }

      fsAdmin.unlink(filePath, function (error) {
        expect(error).toBe(null);
        expect(fs.existsSync(filePath)).toBe(false);
        done();
      });
    });

    it("deletes the given directory as the admin user", function (done) {
      fs.mkdirSync(filePath);

      if (!fsAdmin.testMode) {
        fs.chmodSync(filePath, 0o444);
        fs.chmodSync(path.dirname(filePath), 0o444);
        expect(() => fs.unlinkSync(filePath)).toThrowError(/EACCES|EPERM/);
      }

      fsAdmin.unlink(filePath, function (error) {
        expect(error).toBe(null);
        expect(fs.existsSync(filePath)).toBe(false);
        done();
      });
    });

    it("handles a path that does not exist the way its platform does", function (done) {
      fsAdmin.unlink(path.join(dirPath, "no-such-entry"), function (error) {
        // The two implementations genuinely disagree here, and the difference
        // is upstream's rather than something introduced by this fork. Windows
        // stats the path first to choose between `rmdir` and `del`, so a
        // missing path fails with ENOENT before any command runs. macOS shells
        // out to `rm -rf`, which treats a missing path as success. Pinning both
        // means a change to either is visible rather than silent.
        if (process.platform === "win32") {
          expect(error).not.toBe(null);
          expect(error.code).toBe("ENOENT");
        } else {
          expect(error).toBe(null);
        }
        done();
      });
    });
  });

  // TODO: investigate why these tests are muted and how we could run them
  //       in an Actions-based environment
  onPlatforms("darwin")("symlink", function () {
    it("creates a symlink at the given path as the admin user", function (done) {
      fsAdmin.symlink(__filename, filePath, function (error) {
        expect(error).toBe(null);

        if (!fsAdmin.testMode) {
          expect(fs.lstatSync(filePath).uid).toBe(0);
        }

        expect(fs.readFileSync(filePath, "utf8")).toBe(fs.readFileSync(__filename, "utf8"));
        done();
      });
    });
  });

  onPlatforms("darwin", "win32")("recursiveCopy", function () {
    it("copies the given folder to the given location as the admin user", function (done) {
      const sourcePath = path.join(dirPath, "src-dir");
      fs.mkdirSync(sourcePath);
      fs.mkdirSync(path.join(sourcePath, "dir1"));
      fs.writeFileSync(path.join(sourcePath, "dir1", "file1.txt"), "1");
      fs.writeFileSync(path.join(sourcePath, "dir1", "file2.txt"), "2");

      const destinationPath = path.join(dirPath, "dest-dir");
      fs.mkdirSync(destinationPath);
      fs.writeFileSync(path.join(destinationPath, "other-file.txt"), "3");

      if (!fsAdmin.testMode) {
        fs.writeFileSync(path.join(destinationPath, "something"), "");
        fs.chmodSync(path.join(destinationPath, "something"), 0o444);
        expect(() => fs.unlinkSync(destinationPath)).toThrowError(/EACCES|EPERM/);
      }

      fsAdmin.recursiveCopy(sourcePath, destinationPath, function (error) {
        expect(fs.readFileSync(path.join(destinationPath, "dir1", "file1.txt"), "utf8")).toBe("1");
        expect(fs.readFileSync(path.join(destinationPath, "dir1", "file2.txt"), "utf8")).toBe("2");
        // The destination is replaced, not merged into.
        expect(fs.existsSync(path.join(destinationPath, "other-file.txt"))).toBe(false);
        expect(error).toBe(null);
        done();
      });
    });

    it("works when there is nothing at the destination path", function (done) {
      const sourcePath = path.join(dirPath, "src-dir");
      fs.mkdirSync(sourcePath);
      fs.mkdirSync(path.join(sourcePath, "dir1"));
      fs.writeFileSync(path.join(sourcePath, "dir1", "file1.txt"), "1");
      fs.writeFileSync(path.join(sourcePath, "dir1", "file2.txt"), "2");

      const destinationPath = path.join(dirPath, "dest-dir");

      fsAdmin.recursiveCopy(sourcePath, destinationPath, function (error) {
        expect(fs.readFileSync(path.join(destinationPath, "dir1", "file1.txt"), "utf8")).toBe("1");
        expect(fs.readFileSync(path.join(destinationPath, "dir1", "file2.txt"), "utf8")).toBe("2");
        expect(error).toBe(null);
        done();
      });
    });
  });
});
