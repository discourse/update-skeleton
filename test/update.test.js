import { execa } from "execa";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { update } from "../src/update.js";

async function fixture(t, type = "theme") {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "skeleton-update-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  const snapshot = JSON.parse(
    await fs.readFile(
      new URL(`./fixtures/${type}.json`, import.meta.url),
      "utf8"
    )
  );
  await fs.writeFile(path.join(directory, "about.json"), "{}");
  if (type === "plugin") {
    await fs.writeFile(
      path.join(directory, "plugin.rb"),
      "# name: my-plugin\n"
    );
  }
  const calls = [];
  return {
    directory,
    calls,
    snapshot,
    options: {
      directory,
      fetcher: async (url) => {
        const prefix = `https://raw.githubusercontent.com/discourse/discourse-${type}-skeleton/main/`;
        assert(url.startsWith(prefix));
        return new Response(snapshot.files[url.slice(prefix.length)]);
      },
      run: async (command, args, options) => {
        assert.equal(options.cwd, directory);
        assert.equal(options.extendEnv, false);
        assert.equal(options.env.npm_package_name, undefined);
        calls.push([command, ...args].join(" "));
      },
    },
  };
}

for (const type of ["theme", "plugin"]) {
  test(`${type}: replaces scaffolding, preserves project data, installs, and reruns`, async (t) => {
    const f = await fixture(t, type);
    await fs.writeFile(
      path.join(f.directory, "package.json"),
      JSON.stringify({
        name: "custom-name",
        private: false,
        scripts: { build: "custom build" },
        optionalDependencies: { eslint: "8.0.0" },
        devDependencies: { "ember-template-lint": "1.0.0" },
      })
    );
    await fs.writeFile(
      path.join(f.directory, "eslint.config.mjs"),
      "custom config"
    );
    await fs.writeFile(path.join(f.directory, ".eslintrc.cjs"), "old config");
    await fs.writeFile(
      path.join(f.directory, "source.js.es6"),
      "source stays unchanged"
    );
    await fs.writeFile(path.join(f.directory, ".gitignore"), "my-cache");
    await update(f.options);
    const text = await fs.readFile(
      path.join(f.directory, "package.json"),
      "utf8"
    );
    const pkg = JSON.parse(text);
    assert.equal(pkg.name, "custom-name");
    assert.equal(pkg.private, false);
    assert.equal(pkg.scripts.build, "custom build");
    assert.equal(
      pkg.scripts["update-skeleton"],
      "pnpx @discourse/update-skeleton@latest"
    );
    assert.equal(pkg.optionalDependencies.eslint, "10.6.0");
    assert.equal(pkg.devDependencies.eslint, undefined);
    assert.equal(pkg.devDependencies["ember-template-lint"], undefined);
    assert.equal(pkg.devDependencies["@discourse/update-skeleton"], undefined);
    assert.equal(
      await fs.readFile(path.join(f.directory, "eslint.config.mjs"), "utf8"),
      f.snapshot.files["eslint.config.mjs"]
    );
    assert.equal(
      await fs.readFile(path.join(f.directory, "source.js.es6"), "utf8"),
      "source stays unchanged"
    );
    await assert.rejects(fs.access(path.join(f.directory, ".eslintrc.cjs")), {
      code: "ENOENT",
    });
    if (type === "plugin") {
      assert.match(
        await fs.readFile(path.join(f.directory, "tsconfig.json"), "utf8"),
        /discourse\/plugins\/my-plugin\//
      );
    }
    assert.deepEqual(f.calls, [
      "pnpm --ignore-workspace --config.manage-package-manager-versions=true install --no-frozen-lockfile --prod=false",
      "bundle install",
      "bundle update --bundler",
      "bundle update --all",
    ]);
    const ignore = await fs.readFile(
      path.join(f.directory, ".gitignore"),
      "utf8"
    );
    assert.match(ignore, /^my-cache\n/);
    await update(f.options);
    assert.equal(
      await fs.readFile(path.join(f.directory, "package.json"), "utf8"),
      text
    );
    assert.equal(
      await fs.readFile(path.join(f.directory, ".gitignore"), "utf8"),
      ignore
    );
    assert.equal(f.calls.length, 8);
  });
}

test("rejects an unrecognized project root", async (t) => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.directory, "about.json"));
  await assert.rejects(update(f.options), /theme or plugin root/);
  assert.equal(f.calls.length, 0);
});

test("reports failed downloads and stops before installing", async (t) => {
  const f = await fixture(t);
  f.options.fetcher = async () => new Response("", { status: 503 });
  await assert.rejects(update(f.options), /package.json.*HTTP 503/);
  assert.equal(f.calls.length, 0);
});

test("a failed Bundler update stops subsequent commands and can be retried", async (t) => {
  const f = await fixture(t);
  const run = f.options.run;
  f.options.run = async (command, args, options) => {
    await run(command, args, options);
    if (args.includes("--bundler")) {
      throw new Error("Bundler update failed");
    }
  };
  await assert.rejects(update(f.options), /Bundler update failed/);
  assert.equal(f.calls.at(-1), "bundle update --bundler");
  await update({ ...f.options, run });
  assert.equal(f.calls.at(-1), "bundle update --all");
});

test("CLI help works without a project and unknown options fail", async () => {
  const cli = new URL("../bin/update-skeleton.js", import.meta.url).pathname;
  const { stdout } = await execa(process.execPath, [cli, "--help"]);
  assert.match(stdout, /theme or plugin root/);
  await assert.rejects(
    execa(process.execPath, [cli, "--dry-run"]),
    /Unknown option/
  );
});
