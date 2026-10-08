# fs-admin

Manipulates files with escalated privileges.

Fork of [pulsar-edit/fs-admin](https://github.com/pulsar-edit/fs-admin).

Used as a fallback when an ordinary filesystem call is refused for lack of permission: the editor retries the operation through this module, which prompts for credentials using the platform's own mechanism rather than storing any.

## Features

- **Native escalation**: uses the Authorization Services on macOS, UAC on Windows, and polkit on Linux, so credentials are handled by the platform and never by this module.
- **Elevated writes**: `createWriteStream` returns a stream that writes to a file the current user cannot.
- **Elevated file operations**: `symlink`, `unlink`, `makeTree`, and `recursiveCopy` run their platform's equivalent command as an administrator.
- **One prompt**: obtains credentials synchronously before starting work, so several concurrent operations do not each raise their own dialog.
- **Cache control**: `clearAuthorizationCache` discards credentials the platform is holding.
- **Test mode**: runs the same code paths through unprivileged equivalents, so a suite covering these calls does not need an answerable prompt.

## Installation

```sh
npm install @lumine-code/fs-admin
```

On macOS and Windows, the install script compiles the addon from the sources in this repository; there is no prebuilt binary to download. Linux uses the system's `pkexec` and `dd` directly and needs no native build toolchain.

## Usage

```js
const fsAdmin = require("@lumine-code/fs-admin");

// Retry a write the current user is not allowed to make.
fs.createReadStream(source).pipe(fsAdmin.createWriteStream(destination)).on("error", console.error);

fsAdmin.symlink(target, linkPath, (error) => {
  if (error) console.error(error);
});
```

Not every operation exists on every platform. Windows escalates per command and so exposes no `createWriteStream` or `clearAuthorizationCache`; Linux implements only those two. Check for the function before calling it.

## Building

```sh
npm run build
npm test
```

The suite runs in test mode, because real escalation raises a dialog no automated run can answer. It covers the JavaScript surface, the callback and error paths, native addon loading on macOS and Windows, and Linux operations without a binary. Building is a no-op on Linux.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
