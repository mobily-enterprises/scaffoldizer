import fs from 'fs-extra'
import path from 'path'
import { pathToFileURL } from 'url'
import * as utils from '../lib/utils.js'
import { select, checkbox } from '@inquirer/prompts'
import { program } from 'commander'
import JSON5 from 'json5'
import debugLib from 'debug'

const log = debugLib('logs')

const onPromptCancel = () => {
  console.error('Aborting...')
  process.exit(1)
}

/*
 * **************************************************************
 * Add function (UI)
 * **************************************************************
 */
export const add = async (scaffold, dstDir, modules) => {
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
  // const dstScaffoldizerRemotesDir = path.join(dstScaffoldizerDir, 'remoteScaffolds')
  // fs.ensureDirSync(dstScaffoldizerRemotesDir)

  const userInput = {}
  const vars = {}

  // No module passed: let the user decide
  let modulesToPick = []
  let componentsToPick = []

  const installedModules = {}
  if (!modules.length) {
    const scaffoldModulesDir = path.join(scaffoldDir, 'modules')
    const moduleDirs = fs.readdirSync(scaffoldModulesDir, { withFileTypes: true })
    for (const dirEnt of moduleDirs) {
      let moduleJson5Values
      let fileToLoad
      if (dirEnt.isDirectory()) {
        try {
          fileToLoad = path.join(scaffoldModulesDir, dirEnt.name, 'module.json5')
          moduleJson5Values = JSON5.parse(fs.readFileSync(fileToLoad, 'utf8'))
        } catch (e) {
          console.log('Error with JSON5 in', fileToLoad, e)
        }
        if (moduleJson5Values.hidden) continue
        let dependencies = ''
        if (!moduleJson5Values.shortListed) {
          if (Array.isArray(moduleJson5Values.moduleDependencies) && moduleJson5Values.moduleDependencies.length) {
            dependencies = `, depends on: ${moduleJson5Values.moduleDependencies.join(', ')}`
          } else {
            dependencies = ', no dependencies'
          }
        }

        const componentObject = {
          title: moduleJson5Values.name,
          description: `${moduleJson5Values.description}${dependencies}`,
          value: moduleJson5Values.name,
          position: moduleJson5Values.position
        }

        if (moduleJson5Values.component) {
          componentsToPick.push(componentObject)
        } else {
          modulesToPick.push(componentObject)
        }

        if (fs.existsSync(path.join(dstScaffoldizerInstalledDir, dirEnt.name))) {
          installedModules[dirEnt.name] = true
        }
      }
    }

    modulesToPick = modulesToPick
      // .filter(choice => !installedModules[choice.value])
      // .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      .sort((a, b) => Number(a.shortListPosition) - Number(b.shortListPosition))

    componentsToPick = componentsToPick
      // .filter(choice => Number(choice.position) !== -1)
      .sort((a, b) => Number(a.position) - Number(b.position))

    let choice
    try {
      choice = await select({
        message: 'Chose what you want to add',
        choices: [
          { name: 'Reinstallable components', value: 'components' },
          { name: 'Underlying module', value: 'modules' }
        ]
      })
    } catch (e) { onPromptCancel() }

    if (choice === 'components') {
      try {
        modules = await select({
          message: 'Pick a component to add',
          choices: componentsToPick.map(c => ({ name: c.title || c.name || String(c.value), value: c.value, disabled: c.disabled }))
        })
      } catch (e) { onPromptCancel() }
    } else {
      try {
        modules = await checkbox({
          message: 'Pick several modules to install',
          choices: modulesToPick.map(c => ({ name: c.title || c.name || String(c.value), value: c.value, disabled: c.disabled }))
        })
      } catch (e) { onPromptCancel() }
    }
  }

  if (!Array.isArray(modules)) modules = [modules]
  if (!modules.length) {
    console.log('Nothing to install, quitting...')
  } else {
    const config = {
      dstDir,
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      // dstScaffoldizerRemotesDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
      scaffoldUtilsFunctions,
      userInput,
      scaffoldizerUtils: utils,
      scaffoldDir,
      vars
    }

    const installedModules = []
    for (const module of modules) {
      const $r = await installModule(module, config, false, installedModules)
      if ($r === false) {
        console.log('Installation failed, quitting...')
        process.exit(1)
      }
    }

    // Run the final hook if present
    const scaffoldCode = path.join(config.scaffoldDir, 'code.js')
    let scaffoldCodeFunctions = {}
    if (fs.existsSync(scaffoldCode)) {
      scaffoldCodeFunctions = await import(pathToFileURL(path.resolve(scaffoldCode)).href)
    }
    config.scaffoldCodeFunctions = scaffoldCodeFunctions

    if (scaffoldCodeFunctions.landing) {
      await scaffoldCodeFunctions.landing(config, installedModules)
    }
  }
}

export const installModule = async (module, config, programmatically = false, installedModules = []) => {
  const moduleDir = path.join(config.scaffoldDir, 'modules', module)
  const moduleInstallFile = path.join(config.dstScaffoldizerInstalledDir, module)
  const verbose = program.verbose

  if (verbose) log('Processing adding module', module, programmatically ? ' programmatically' : '')
  // Check if module is available
  if (!utils.isDir(moduleDir)) {
    console.log(`FATAL: Kit not found: ${module}`)
    process.exit(1)
  }

  const moduleJson5 = path.join(moduleDir, 'module.json5')
  if (!fs.existsSync(moduleJson5)) {
    console.log(`FATAL: Module is missing the module.json5 file: ${module}`)
    process.exit(1)
  }
  const moduleJson5Values = JSON5.parse(fs.readFileSync(moduleJson5, 'utf-8'))

  const deps = moduleJson5Values.moduleDependencies || []
  if (verbose && deps.length) console.log('This module has dependencies. Installing them.', deps)

  for (const module of deps) {
    const $r = await installModule(module, config, programmatically, installedModules)
    if ($r === false) {
      console.log('Installation failed, quitting...')
      process.exit(1)
    }
  }

  if (verbose && deps.length) console.log('Dependencies installed.', deps)

  const c = config = {
    ...config,
    moduleJson5Values,
    moduleDir,
    moduleInstallFile
  }

  // Include code
  const moduleCode = path.join(moduleDir, 'code.js')
  let moduleCodeFunctions = {}
  if (fs.existsSync(moduleCode)) {
    moduleCodeFunctions = await import(pathToFileURL(path.resolve(moduleCode)).href)
  }
  config.moduleCodeFunctions = moduleCodeFunctions

  // Check if module is already installed, skip everything if it is
  if (fs.existsSync(moduleInstallFile)) {
    if (verbose) console.log(`${module} already installed, skipping...`)

    // Use the install file as source of the user input provided at
    // installation time
    c.userInput[module] = fs.readJsonSync(moduleInstallFile)

    // Run the boot function
    if (moduleCodeFunctions.boot) moduleCodeFunctions.boot(config)
    return
  }

  // Add the current module to the total list of installed modules
  installedModules.push({ module, moduleJson5Values, configCopy: JSON.parse(JSON.stringify(config)) })

  console.log(`Actually installing ${module}...`)

  // Install dependendencies first

  c.userInput[module] = {}
  if (moduleCodeFunctions.prePrompts) {
    await moduleCodeFunctions.prePrompts(config)
  }

  if (programmatically) {
    c.userInput[module] = programmatically || {}
    c.programmatically = true
    // console.log('Answers came programmatically:', c.userInput[module])
  } else {
    if (moduleCodeFunctions.getPrompts) {
      if (moduleCodeFunctions.getPromptsHeading) moduleCodeFunctions.getPromptsHeading()
      c.userInput[module] = await moduleCodeFunctions.getPrompts(config) || {}
      // console.log('Answers came from prompts:', c.userInput[module])
    }
    c.programmatically = false
  }

  if (moduleCodeFunctions.postPrompts) {
    await moduleCodeFunctions.postPrompts(config, c.userInput[module])
  }

  // Run the preAdd hook if defined

  if (moduleCodeFunctions.preAdd) {
    const $r = await moduleCodeFunctions.preAdd(config, c.userInput[module])
    if ($r === false) return false
  }

  // Run the boot function. This is run even if the module is already
  // installed. However, if the module is NOT already installed, it's
  // also run
  if (moduleCodeFunctions.boot) {
    const $r = await moduleCodeFunctions.boot(config, c.userInput[module])
    if ($r === false) return false
  }

  const moduleDistrDir = path.join(moduleDir, 'distr')
  if (utils.isDir(moduleDistrDir)) {
    if (verbose) console.log('"distr" folder found, copying files over')
    utils.copyRecursiveSync(config, moduleDistrDir, c.dstDir)
  }

  // Copy the "extraCopyDirectory" files, if module says so
  if (moduleJson5Values.extraCopyDirectory) {
    const commonDir = path.join(c.scaffoldDir, moduleJson5Values.extraCopyDirectory)
    if (utils.isDir(commonDir)) {
      if (verbose) console.log('Extra copy directory found, copying files over')
      utils.copyRecursiveSync(config, commonDir, c.dstDir)
    }
  }

  // Execute on requested inserts in destination files
  const manipulations = moduleJson5Values.manipulate || {}
  await utils.executeManipulations(config, manipulations)

  if (!moduleJson5Values.component) {
    // Mark it as installed in metadata (create lock file)
    fs.writeJsonSync(moduleInstallFile, c.userInput[module])
  }

  if (moduleCodeFunctions.postAdd) {
    const $r = await moduleCodeFunctions.postAdd(config, c.userInput[module])
    if ($r === false) return false
  }

  // Module installed!
  if (verbose) console.log('Module installed:', module)
}
