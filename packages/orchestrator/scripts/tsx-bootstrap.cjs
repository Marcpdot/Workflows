// tsx asks libuv for passwd data on Windows when process.geteuid is absent.
// Some service shells cannot provide it; a stable local uid avoids that lookup.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  process.geteuid = () => 0;
}
