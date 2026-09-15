import { execa } from "execa";
import * as fs from "node:fs/promises";
import path from "node:path";

export async function update({
  directory = process.cwd(),
  fetcher = fetch,
  run = execa,
} = {}) {
  const read = async (file) => {
    try {
      return await fs.readFile(path.join(directory, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };
  const write = async (file, content) => {
    await fs.writeFile(path.join(directory, file), content);
    console.log(`Updated ${file}`);
  };

  const plugin = await read("plugin.rb");
  const type = plugin === null ? "theme" : "plugin";
  if (type === "theme" && (await read("about.json")) === null) {
    throw new Error(
      "Run from a theme or plugin root (about.json or plugin.rb is required)"
    );
  }
  const pluginName = plugin?.match(/^#\s*name:\s*([\w-]+)\s*$/m)?.[1];
  if (type === "plugin" && !pluginName) {
    throw new Error(
      "plugin.rb needs a '# name: my-plugin' header for TypeScript paths"
    );
  }

  const base = `https://raw.githubusercontent.com/discourse/discourse-${type}-skeleton/main`;
  const download = async (file) => {
    const response = await fetcher(`${base}/${file}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Fetching ${file} failed: HTTP ${response.status}`);
    }
    return response.text();
  };

  const template = JSON.parse(await download("package.json"));
  const pkg = JSON.parse((await read("package.json")) || "{}");
  pkg.private ??= template.private;
  pkg.packageManager = template.packageManager;
  pkg.engines = { ...pkg.engines, ...template.engines };
  pkg.scripts = { ...pkg.scripts, ...template.scripts };
  pkg.devDependencies = { ...pkg.devDependencies, ...template.devDependencies };
  // Update existing runtime entries in place instead of adding dev duplicates.
  for (const section of ["dependencies", "optionalDependencies"]) {
    for (const name of Object.keys(pkg[section] || {})) {
      if (Object.hasOwn(template.devDependencies, name)) {
        pkg[section][name] = template.devDependencies[name];
        delete pkg.devDependencies[name];
      }
    }
  }
  for (const name of [
    "ember-template-lint",
    "@babel/plugin-proposal-decorators",
    "lint-to-the-future-ember-template",
  ]) {
    delete pkg.devDependencies[name];
  }
  delete pkg.scripts["lint:hbs"];
  delete pkg.scripts["lint:hbs:fix"];
  await write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  await fs.mkdir(path.join(directory, ".github/workflows"), {
    recursive: true,
  });
  for (const file of [
    "eslint.config.mjs",
    ".prettierrc.cjs",
    "stylelint.config.mjs",
    "tsconfig.json",
    ".rubocop.yml",
    ".streerc",
    "Gemfile",
    `.github/workflows/discourse-${type}.yml`,
    ".github/workflows/d-compat-branch.yml",
  ]) {
    let content = await download(file);
    if (file === "tsconfig.json" && type === "plugin") {
      content = content.replaceAll("discourse-plugin-skeleton", pluginName);
    }
    await write(file, content);
  }

  const prefix = type === "plugin" ? "plugin" : "component";
  for (const file of [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    "eslint.config.js",
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.json",
    ".template-lintrc.js",
    ".template-lintrc.cjs",
    ".stylelintrc",
    ".stylelintrc.json",
    ".stylelintrc.js",
    ".stylelintrc.cjs",
    `.github/workflows/${prefix}-linting.yml`,
    `.github/workflows/${prefix}-tests.yml`,
  ]) {
    await fs.rm(path.join(directory, file), { force: true });
  }
  let ignore = (await read(".gitignore")) || "";
  for (const line of (await download(".gitignore"))
    .split(/\r?\n/)
    .filter(Boolean)) {
    if (!ignore.split(/\r?\n/).includes(line)) {
      ignore += `${ignore && !ignore.endsWith("\n") ? "\n" : ""}${line}\n`;
    }
  }
  await write(".gitignore", ignore);

  // Keep registry/auth settings, but remove the calling package's metadata.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^npm_(package_|lifecycle_|command$|execpath$|node_execpath$)/i.test(
        key
      ) ||
      ["BUNDLE_GEMFILE", "BUNDLE_BIN_PATH"].includes(key)
    ) {
      delete env[key];
    }
  }
  const options = { cwd: directory, env, extendEnv: false, stdio: "inherit" };
  await run(
    "pnpm",
    [
      "--ignore-workspace",
      "--config.manage-package-manager-versions=true",
      "install",
      "--no-frozen-lockfile",
      "--prod=false",
    ],
    options
  );
  await run("bundle", ["install"], options);
  await run("bundle", ["update", "--bundler"], options);
  await run("bundle", ["update", "--all"], options);
  console.log(`Done. Review the diff, then run:
  pnpm lint:fix
  pnpm lint
  bundle exec stree write Gemfile $(git ls-files '*.rb' '*.rake' '*.thor')
  bundle exec rubocop -A
  bundle exec rubocop`);
}
