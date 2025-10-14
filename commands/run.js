import fs from 'fs-extra'
import path from 'path'
import { pathToFileURL } from 'url'
import * as utils from '../lib/utils.js'
import { select } from '@inquirer/prompts'
import { program } from 'commander'
import JSON5 from 'json5'

const onPromptCancel = () => {
  console.error('Aborting...')
  process.exit(1)
}

/*
 * **************************************************************
 * Add function (UI)
 * **************************************************************
 */
export const run = async (scaffold, dstDir, script) => {
  let config

  // Destination directory must exist
  if (!utils.isDir(dstDir)) {
    console.error('Could not find destination dir:', dstDir)
    process.exit(1)
  }

  const dstPackageJson = path.join(dstDir, 'package.json')
  let dstPackageJsonValues
  if (!fs.pathExistsSync(dstPackageJson)) {
    dstPackageJsonValues = {}
  } else {
    dstPackageJsonValues = fs.readJsonSync(dstPackageJson)
  }

  const scaffoldDir = await utils.resolveScaffold(scaffold, dstDir)
  if (!utils.isDir(scaffoldDir)) {
    console.error('Could not find scaffold dir:', scaffoldDir)
    process.exit(1)
  }
  const scaffoldPackageJson = path.join(scaffoldDir, 'package.json')
  if (!fs.pathExistsSync(scaffoldPackageJson)) {
    console.error('Scaffold source must be a scaffold package')
    process.exit(1)
  }
  const scaffoldPackageJsonValues = fs.readJsonSync(scaffoldPackageJson)

  const scaffoldUtilsSource = path.join(scaffoldDir, 'utils.js')
  let scaffoldUtilsFunctions = {}
  if (fs.existsSync(scaffoldUtilsSource)) {
    scaffoldUtilsFunctions = await import(pathToFileURL(path.resolve(scaffoldUtilsSource)).href)
  }

  if (!scaffoldPackageJsonValues.forScaffoldizer) {
    console.error('Scaffold source must be a scaffold package')
    process.exit(1)
  }

  // scaffoldizer/* directories must exist
  const dstScaffoldizerDir = path.join(dstDir, 'scaffoldizer')
  fs.ensureDirSync(dstScaffoldizerDir)
  const dstScaffoldizerInstalledDir = path.join(dstScaffoldizerDir, 'installedModules')
  fs.ensureDirSync(dstScaffoldizerInstalledDir)

  const vars = {}

  // No module passed: let the user decide
  let scriptsToPick = []

  if (!script) {
    const scaffoldScriptsDir = path.join(scaffoldDir, 'scripts')
    const scriptDirs = fs.readdirSync(scaffoldScriptsDir, { withFileTypes: true })
    for (const dirEnt of scriptDirs) {
      if (dirEnt.isDirectory()) {
        // console.log(dirEnt.name)
        const scriptJson5Values = JSON5.parse(fs.readFileSync(path.join(scaffoldScriptsDir, dirEnt.name, 'script.json5'), 'utf8'))

        const componentObject = {
          title: scriptJson5Values.name,
          description: `${scriptJson5Values.description}`,
          value: scriptJson5Values.name,
          position: scriptJson5Values.position
        }

        scriptsToPick.push(componentObject)
      }
    }

    scriptsToPick = scriptsToPick.sort((a, b) => Number(a.position) - Number(b.position))

    try {
      script = await select({
        message: 'Pick a script to run',
        choices: scriptsToPick.map(c => ({ name: c.title || c.name || String(c.value), value: c.value, disabled: c.disabled }))
      })
    } catch (e) { onPromptCancel() }

    config = {
      dstDir,
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
      scaffoldUtilsFunctions,
      scaffoldizerUtils: utils,
      scaffoldDir,
      vars
    }
  }
  await runScript(script, config)
}

export const runScript = async (script, config, programmatically) => {
  const scriptDir = path.join(config.scaffoldDir, 'scripts', script)
  const verbose = program.verbose

  // Check if module is available
  if (!utils.isDir(scriptDir)) {
    console.log(`FATAL: Script not found: ${script}`)
    process.exit(1)
  }

  const scriptJson5 = path.join(scriptDir, 'script.json5')
  if (!fs.existsSync(scriptJson5)) {
    console.log(`FATAL: Module is missing the module.json5 file: ${script}`)
    process.exit(1)
  }
  const scriptJson5Values = JSON5.parse(fs.readFileSync(scriptJson5, 'utf-8'))

  config = {
    ...config,
    scriptDir,
    scriptJson5,
    scriptJson5Values
  }

  // Include code
  const scriptCode = path.join(scriptDir, 'code.js')
  let scriptCodeFunctions = {}
  if (fs.existsSync(scriptCode)) {
    scriptCodeFunctions = await import(pathToFileURL(path.resolve(scriptCode)).href)
  }
  config.scriptCodeFunctions = scriptCodeFunctions

  config.userInput = {}
  if (programmatically) {
    config.userInput[script] = programmatically
  } else {
    if (scriptCodeFunctions.getPrompts) {
      if (verbose) console.log('Getting script prompts.')
      // Note: getPrompts might set values in  userInput[module] programmatically
      config.userInput[script] = await scriptCodeFunctions.getPrompts(config) || {}
    }
  }

  if (scriptCodeFunctions.postPrompts) {
    await scriptCodeFunctions.postPrompts(config, config.userInput[script])
  }

  if (verbose) console.log(`Running ${script} ${config}...`)
  await scriptCodeFunctions.script(config)
}
