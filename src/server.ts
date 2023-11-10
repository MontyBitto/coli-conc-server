#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run --allow-sys --ext=ts --lock=/home/stefan/src/deno.lock

/**
 * Script to manage services.
 * 
 * Current assumptions:
 * - Only Docker and Node.js are supported
 * - Docker services are defined through a `docker-compose.yml` file
 * - Node.js services have a `package.json` file with defined dependencies (optionally a lockfile `package-lock.json`)
 *   and also provide a `ecosystem.example.json` example configuration file for pm2.
 */

Deno.env.set("FORCE_COLOR", "2")

import { command as _command, target } from "../src/args.ts"
// We override command in "init"
let command = _command
// TODO: Relative or absolute path?
const servicePath = "/home/stefan/services"
const targetPath = `${servicePath}/${target}`

import { $, cd } from "npm:zx@7"
import { exists } from "https://deno.land/std/fs/mod.ts"
import { readJson, writeJson } from "../src/json.ts"

if (!await exists(targetPath)) {
  console.error(`Error: Service "${target}" does not exist.`)
  Deno.exit(1)
}

// Determine type of target
enum TargetTypes {
  DockerCompose,
  Node,
  NodeNoLockfile,
  Unknown,
}
let targetType = TargetTypes.Unknown

if (await exists(`${targetPath}/package-lock.json`)) {
  targetType = TargetTypes.Node
} else if (await exists(`${targetPath}/package.json`)) {
  targetType = TargetTypes.NodeNoLockfile
} else if (await exists(`${targetPath}/docker-compose.yml`)) {
  targetType = TargetTypes.DockerCompose
}

if (targetType === TargetTypes.Unknown) {
  console.error(`Error: Unsupported target type in "${target}.`)
  Deno.exit(1)
}
await cd(`${targetPath}`)

if (command === "update") {
  // This simply updates Git repositories. Docker Compose services will be updated through "init" anyway which is run afterwards.
  if (await exists(".git")) {
    await $`git fetch --tags`
    await $`git fetch --all`
    await $`git pull`
    // ? In the old script, we also had checkouts to reset package(-lock).json files and a hard reset. Do we need that here too?
  }
  // Continue with "init" which installs dependencies
  command = "init"
}

if (command === "init") {
  switch (targetType) {
    case TargetTypes.DockerCompose:
      await $`docker compose pull`
      break
    case TargetTypes.Node:
    case TargetTypes.NodeNoLockfile: {
      if (targetType === TargetTypes.Node) {
        await $`npm ci`
      } else {
        await $`npm i --no-package-lock`
      }
      const pkg = await readJson("package.json")
      if (pkg?.scripts?.build) {
        await $`npm run build`
      }
      try {
        const ecosystem = await readJson("ecosystem.example.json")
        ecosystem.name = target
        // TODO: Consider adjusting Node.js version if necessary
        await writeJson("ecosystem.config.json", ecosystem)
      } catch (_error) {
        console.warn(`Could not create ecosystem file for pm2.`)
      }
      break
    }
  }
  // Run "start" after init
  command = "start"
}

if (command === "start") {
  switch (targetType) {
    case TargetTypes.DockerCompose:
      await $`docker compose up -d`
      break
    case TargetTypes.Node:
    case TargetTypes.NodeNoLockfile:
      // TODO: What if there is no ecosystem file?
      await $`pm2 startOrReload ecosystem.config.json`
      await $`pm2 save`
      break
  }
}

if (command === "restart") {
  switch (targetType) {
    case TargetTypes.DockerCompose:
      await $`docker compose stop`
      await $`docker compose up -d`
      break
    case TargetTypes.Node:
    case TargetTypes.NodeNoLockfile:
      // TODO: What if there is no ecosystem file?
      await $`pm2 restart ecosystem.config.json`
      break
  }
}

if (command === "stop") {
  switch (targetType) {
    case TargetTypes.DockerCompose:
      await $`docker compose stop`
      break
    case TargetTypes.Node:
    case TargetTypes.NodeNoLockfile:
      // TODO: What if there is no ecosystem file?
      await $`pm2 stop ecosystem.config.json`
      break
  }
}

if (command === "logs" || command === "log") {
  switch (targetType) {
    case TargetTypes.DockerCompose:
      await $`docker compose logs --follow --tail 100`
      break
    case TargetTypes.Node:
    case TargetTypes.NodeNoLockfile:
      await $`pm2 logs ${target} --lines 100`
      break
  }
}