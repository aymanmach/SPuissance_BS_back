const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, "server.js"),
  path.join(root, "config"),
  path.join(root, "middlewares"),
  path.join(root, "routes"),
  path.join(root, "services"),
  path.join(root, "websocket"),
];

function collectJsFiles(entryPath, files) {
  if (!fs.existsSync(entryPath)) {
    return;
  }

  const stat = fs.statSync(entryPath);

  if (stat.isFile()) {
    if (entryPath.endsWith(".js")) {
      files.push(entryPath);
    }
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  const entries = fs.readdirSync(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = path.join(entryPath, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(childPath, files);
      continue;
    }
    if (entry.isFile() && childPath.endsWith(".js")) {
      files.push(childPath);
    }
  }
}

const jsFiles = [];
for (const target of targets) {
  collectJsFiles(target, jsFiles);
}

if (!jsFiles.length) {
  console.log("No JS files found to check.");
  process.exit(0);
}

let hasErrors = false;

for (const filePath of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`Syntax check passed for ${jsFiles.length} files.`);
