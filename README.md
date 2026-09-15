# discourse-skeleton-update

Update a Discourse theme or plugin's scaffolding and install its dependencies.
Requires Node.js 22.13+, pnpm, Ruby, and Bundler.

Run from the theme or plugin root:

```sh
pnpx discourse-skeleton-update@latest
```

Skeletons also provide `pnpm discourse-skeleton-update`, which runs that command
without adding the updater as a dependency. For local development, run
`node /path/to/discourse-skeleton-update/bin/discourse-skeleton-update.js`.

## What it does

1. Detect a plugin using `plugin.rb`, otherwise a theme using `about.json`.
2. Fetch current files from the matching skeleton's `raw.githubusercontent.com`
   `/main/` URLs, without using the GitHub API.
3. Merge package dependencies, scripts, and engine settings. Replace lint configs,
   TypeScript config, Gemfile, and standard workflows; remove obsolete configs.
   Append required `.gitignore` entries. Plugin TypeScript paths use its name header.
4. Install with pnpm, then run `bundle install`, `bundle update --bundler`, and
   `bundle update --all`.
5. Print lint and autofix commands for you to run.

Managed configs are overwritten, including customizations. Unrelated package data
and source files are preserved. Updates write directly to disk; failures leave
completed changes in place. Fix the error and rerun. No state file or dry run.

pnpm installs stay within this project and include dev dependencies, even with
`NODE_ENV=production`. Ruby gems are updated within the Gemfile's constraints.

## Development

```sh
pnpm install
pnpm lint:fix
pnpm lint
pnpm test
pnpm pack
```

The implementation uses `execa` for running commands and Node built-ins for
files and HTTP. Tests use local skeleton fixtures and stub the installers.
ESLint and Prettier use `@discourse/lint-configs`.

## Releases

Like [lint-configs](https://github.com/discourse/lint-configs/blob/main/.github/workflows/ci.yml),
CI publishes unpublished versions to npm after checks pass on `main`.
To release, bump `version` in `package.json` and merge to `main`.
Already published versions are skipped by `pnpm publish -r`.

Configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/)
for the package: organization `discourse`, repository `discourse-skeleton-update`,
workflow `ci.yml`, no environment, with direct publishing allowed. No npm token
secret is needed. If the package does not exist yet, publish its first version
manually before configuring the trusted publisher.
