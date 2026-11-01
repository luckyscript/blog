import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Report variable names only; never print matched text from generated bundles.
const needles = Object.entries(process.env).flatMap(([name, value]) => {
  if (!value || value.length < 8 || !/(?:DATABASE_URL|PASSWORD|SECRET(?:_KEY)?|PRIVATE_KEY|TOKEN|MOMENTS_HTTP_PROXY)$/.test(name)) return [];
  const items = [{ name, value }];
  if (name.endsWith("DATABASE_URL")) {
    const password = decodeURIComponent(new URL(value).password);
    if (password.length >= 8) items.push({ name: `${name} password`, value: password });
  }
  return items;
});
const matches = [];
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await scan(filename);
    else if (/\.(?:m?js|html|json|map)$/.test(filename)) {
      const content = await readFile(filename, "utf8");
      for (const needle of needles)
        if (content.includes(needle.value)) matches.push({ filename, variable: needle.name });
    }
  }
}
await scan("dist");
console.log(JSON.stringify({ checkedSecrets: needles.length, matches }));
if (matches.length) process.exitCode = 1;
