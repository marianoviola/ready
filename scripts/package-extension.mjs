import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const pkg = await readJson(path.join(root, "package.json"));
const manifest = await readJson(path.join(root, "dist/manifest.json"));
if (pkg.version !== manifest.version || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error("Package and extension versions must match and use major.minor.patch.");
}
const staging = await mkdtemp(path.join(tmpdir(), "ready-package-"));
try {
  const entries = [];
  async function stage(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        await stage(path.join(directory, entry.name), name);
      } else if (entry.isFile() && !name.endsWith(".map")) {
        const target = path.join(staging, name);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(directory, entry.name), target);
        entries.push(name);
      } else if (!entry.isFile()) {
        throw new Error(`Unexpected non-file in dist: ${name}`);
      }
    }
  }
  await stage(path.join(root, "dist"));
  await copyFile(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
  entries.push("LICENSE");

  const notices = ["Ready bundles the following third-party software under its respective license.\n"];
  for (const name of ["dexie", "react", "react-dom", "scheduler"]) {
    const directory = path.join(root, "node_modules", name);
    const dependency = await readJson(path.join(directory, "package.json"));
    notices.push(`\n--- ${name} ${dependency.version} (${dependency.license}) ---\n`);
    notices.push(await readFile(path.join(directory, "LICENSE"), "utf8"));
    for (const file of ["NOTICE", "NOTICE.txt"]) {
      if ((await readdir(directory)).includes(file)) {
        notices.push(await readFile(path.join(directory, file), "utf8"));
      }
    }
  }
  await writeFile(path.join(staging, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
  entries.push("THIRD-PARTY-NOTICES.txt");
  for (const name of entries) {
    await chmod(path.join(staging, name), 0o644);
    await utimes(path.join(staging, name), new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
  }
  const archive = execFileSync("zip", ["-X", "-q", "-", ...entries.sort()], {
    cwd: staging,
    env: { ...process.env, TZ: "UTC" },
    maxBuffer: 32 * 1024 * 1024
  });
  const directory = path.join(root, "release");
  const filename = `ready-${pkg.version}.zip`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), archive);
  const hash = createHash("sha256").update(archive).digest("hex");
  await writeFile(path.join(directory, `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`Created release/${filename} and SHA-256 checksum.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
