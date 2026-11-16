import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("release ZIP is complete, licensed, versioned and repeatable", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const filename = `ready-${pkg.version}.zip`;
  const archive = `release/${filename}`;
  const bytes = await readFile(archive);
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
  for (const required of ["manifest.json", "sidebar.html", "background.js", "content.js", "LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
    assert.ok(entries.includes(required), `Missing ${required}`);
  }
  assert.ok(entries.every((entry) => !entry.endsWith(".map") && !entry.startsWith("dist/") && !entry.includes("node_modules/")));
  const readEntry = (name) => execFileSync("unzip", ["-p", archive, name], { encoding: "utf8" });
  const builtFiles = (await readdir("dist", { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".map"));
  for (const entry of builtFiles) {
    const fullPath = `${entry.parentPath}/${entry.name}`;
    const name = fullPath.replace(/^dist\//, "");
    assert.ok(entries.includes(name), `Missing built file ${name}`);
    assert.deepEqual(execFileSync("unzip", ["-p", archive, name]), await readFile(fullPath));
  }
  const manifest = JSON.parse(readEntry("manifest.json"));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.version_name, pkg.version);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.homepage_url, pkg.homepage);
  assert.equal(new URL(manifest.homepage_url).protocol, "https:");
  assert.ok(!manifest.host_permissions?.length, "Site access must remain optional.");
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
  assert.ok(manifest.description.length <= 132, "Store summary exceeds the manifest limit.");
  for (const icon of Object.values(manifest.icons)) assert.ok(entries.includes(icon));
  const html = readEntry("sidebar.html");
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    assert.ok(entries.includes(match[1].replace(/^\//, "")), `Missing asset ${match[1]}`);
  }
  const notices = readEntry("THIRD-PARTY-NOTICES.txt");
  for (const dependency of ["dexie", "react", "react-dom", "scheduler"]) {
    assert.ok(notices.includes(`--- ${dependency} `), `Missing license for ${dependency}`);
  }
  assert.ok(notices.includes("Apache License"));
  assert.ok(notices.includes("Permission is hereby granted"));
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(await readFile(`${archive}.sha256`, "utf8"), `${hash}  ${filename}\n`);
  execFileSync(process.execPath, ["scripts/package-extension.mjs"]);
  assert.deepEqual(await readFile(archive), bytes);
});
