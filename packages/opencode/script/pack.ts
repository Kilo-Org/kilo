#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/kilo --version`)
  await $`./dist/${name}/bin/kilo --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
// kilocode_change start - copy Kilocode README for npm package
await $`cp ./NPM_README.md ./dist/${pkg.name}/README.md`
// kilocode_change end

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      version: Script.version,
      // kilocode_change start - add Kilocode branding metadata
      description: "AI-powered development tool that helps you code faster and smarter",
      keywords: [
        "ai",
        "coding",
        "cli",
        "development",
        "assistant",
        "code-generation",
        "productivity",
        "kilocode",
      ],
      homepage: "https://kilocode.dev",
      repository: {
        type: "git",
        url: "https://github.com/kilocode/kilo-cli.git",
      },
      bugs: {
        url: "https://github.com/kilocode/kilo-cli/issues",
      },
      license: "MIT",
      author: "Kilo Code",
      // kilocode_change end
      bin: {
        kilo: `./bin/kilo`,
        kilocode: `./bin/kilo`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tags = [Script.channel]

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack --destination ..`.cwd(`./dist/${name}`)
})
await Promise.all(tasks)
for (const tag of tags) {
  await $`cd ./dist/${pkg.name} && bun pm pack --destination ..`
}

if (!Script.preview) {
  // Create archives for GitHub release
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }

  const image = "ghcr.io/anomalyco/opencode"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
}
