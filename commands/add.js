const fs = require('fs-extra')
const path = require('path')
const utils = require('../lib/utils')
const stringify = require('json-stable-stringify')
const prompts = require('prompts')
const ejs = require('ejs')
const { program } = require('commander')
const JSON5 = require('json5')

exports = module.exports = async (scaffold, dstDir, modules) => {
  const verbose = program.verbose
  // Destination directory must exist
  if (!utils.isDir(dstDir)) {
    console.error('Could not find destination dir:', dstDir)
    process.exit(1)
  }
  const dstPackageJson = path.join(dstDir, 'package.json')
  if (!fs.pathExistsSync(dstPackageJson)) {
    console.error('Destination directory must contain package.json')
    process.exit(1)
  }
  const dstPackageJsonValues = fs.readJsonSync(dstPackageJson)

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
    scaffoldUtilsFunctions = require(path.resolve(scaffoldUtilsSource))
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
  const dstScaffoldizerRemotesDir = path.join(dstScaffoldizerDir, 'remoteScaffolds')
  fs.ensureDirSync(dstScaffoldizerRemotesDir)

  const onPromptCancel = (prompt) => {
    console.error('Aborting...')
    process.exit(1)
  }

  const userInput = {}
  const vars = {}

  // No module passed: let the user decide
  let choices = []
  let shortListChoices = []
  let actualShortListChoices

  const installedModules = {}
  if (!modules.length) {
    const scaffoldModulesDir = path.join(scaffoldDir, 'modules')
    const moduleDirs = fs.readdirSync(scaffoldModulesDir, { withFileTypes: true })
    for (const dirEnt of moduleDirs) {
      if (dirEnt.isDirectory()) {
        // console.log(dirEnt.name)
        const modulePackageJsonValues = JSON5.parse(fs.readFileSync(path.join(scaffoldModulesDir, dirEnt.name, 'module.json5'), 'utf8'))
        let dependencies = ''
        let isComponentString = ''
        if (!modulePackageJsonValues.shortListed) {
          if (Array.isArray(modulePackageJsonValues.moduleDependencies) && modulePackageJsonValues.moduleDependencies.length) {
            dependencies = `, depends on: ${modulePackageJsonValues.moduleDependencies.join(', ')}`
          } else {
            dependencies = ', no dependencies'
          }
        }
        if (modulePackageJsonValues.component) {
          isComponentString = '[component] '
        }

        const componentObject = {
          title: `${isComponentString}${modulePackageJsonValues.name}`,
          description: `${modulePackageJsonValues.description}${dependencies}`,
          value: modulePackageJsonValues.name,
          position: modulePackageJsonValues.position
        }

        if (modulePackageJsonValues.shortListed) {
          shortListChoices.push(componentObject)
        } else {
          choices.push(componentObject)
        }

        if (fs.existsSync(path.join(dstScaffoldizerInstalledDir, dirEnt.name))) {
          installedModules[dirEnt.name] = true
        }
      }
    }

    shortListChoices = shortListChoices
      .filter(choice => !installedModules[choice.value] || choice.component)
      // .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      .sort((a, b) => Number(a.shortListPosition) - Number(b.shortListPosition))

    choices = choices
      // .filter(choice => Number(choice.position) !== -1)
      .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      .sort((a, b) => Number(a.position) - Number(b.position))

    actualShortListChoices = shortListChoices.filter(choice => !choice.disabled)

    if (actualShortListChoices.length) {
      modules = (await prompts({
        type: 'select',
        name: 'value',
        message: 'pick a module to install',
        choices: [...shortListChoices, {
          title: 'Pick individual modules',
          value: '__INDIVIDUAL__'
        }]
      }, { onCancel: onPromptCancel })).value
    }

    if (modules === '__INDIVIDUAL__' || !actualShortListChoices.length) {
      modules = (await prompts({
        type: 'multiselect',
        name: 'value',
        message: 'pick a module to install',
        choices
      }, { onCancel: onPromptCancel })).value
    }
  }

  if (!Array.isArray(modules)) modules = [modules]
  if (!modules.length) {
    console.log('Nothing to install, quitting...')
  } else {
    for (const module of modules) await installModule(module)
  }

  async function installModule (module) {
    const moduleDir = path.join(scaffoldDir, 'modules', module)
    const moduleInstallFile = path.join(dstScaffoldizerInstalledDir, module)

    // Check if module is available
    if (!utils.isDir(moduleDir)) {
      console.log(`FATAL: Kit not found: ${module}`)
      process.exit(1)
    }

    // Check if module is already installed
    if (verbose && fs.existsSync(moduleInstallFile)) {
      console.log(`${module} already installed, skipping...`)
      return
    }

    console.log(`Installing ${module}`)

    // Install dependendencies first

    const modulePackageJson = path.join(moduleDir, 'module.json5')
    if (!fs.existsSync(modulePackageJson)) {
      console.log(`FATAL: Module is missing the package.json file: ${module}`)
      process.exit(1)
    }
    const modulePackageJsonValues = fs.readJsonSync(modulePackageJson)

    const deps = modulePackageJsonValues.moduleDependencies || []
    if (verbose && deps.length) console.log('This module has dependencies. Installing them.', deps)
    for (const module of deps) {
      await installModule(module)
    }
    if (verbose && deps.length) console.log('Dependencies installed.', deps)

    // Actually installing the module!
    console.log('Installing:', module)

    const config = {
      moduleDir,
      moduleInstallFile,
      dstDir,
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      dstScaffoldizerRemotesDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
      scaffoldUtilsFunctions,
      modulePackageJsonValues,
      userInput,
      utils,
      vars
    }

    // Include code
    const moduleCode = path.join(moduleDir, 'code.js')
    let moduleCodeFunctions = {}
    if (fs.existsSync(moduleCode)) {
      moduleCodeFunctions = require(path.resolve(moduleCode))
    }
    config.moduleCodeFunctions = moduleCodeFunctions

    if (moduleCodeFunctions.prePrompts) moduleCodeFunctions.prePrompts(config)

    if (moduleCodeFunctions.getPrompts) {
      const $p = moduleCodeFunctions.getPrompts(config)
      let $h
      if (moduleCodeFunctions.getPromptsHeading) $h = moduleCodeFunctions.getPromptsHeading()
      if ($h) console.log(`\n${$h}\n`)
      userInput[module] = await prompts($p, { onCancel: onPromptCancel })
    }

    if (moduleCodeFunctions.preAdd) moduleCodeFunctions.preAdd(config)


    const moduleDistrDir = path.join(moduleDir, 'distr')
    if (moduleDistrDir === 'Development/js-kit/modules/client-app-frame/distr') debugger
    if (utils.isDir(moduleDistrDir)) {
      if (verbose) console.log('"distr" folder found, copying files over')
      utils.copyRecursiveSync(moduleDistrDir, dstDir, config)
    }

    // Carry on requested inserts in destination files
    const manipulations = modulePackageJsonValues.manipulate || {}
    const jsonManipulations = manipulations.json || {}
    const textManipulations = manipulations.text || {}

    let listOfManipulations
    let contents

    // TEXT MANIPULATIONS
    for (const fileRelativePath in textManipulations) {
      const resolvedFileRelativePath = ejs.render(fileRelativePath, config)
      listOfManipulations = textManipulations[fileRelativePath]
      if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
      try {
        contents = fs.readFileSync(path.join(dstDir, resolvedFileRelativePath)).toString()
      } catch (e) {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath, 'resolved as', resolvedFileRelativePath)
        debugger
        continue
      }
      contents = await utils.manipulateText(contents, listOfManipulations, config)
      fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), contents)
    }

    // JSON MANIPULATIONS
    for (const fileRelativePath in jsonManipulations) {
      const resolvedFileRelativePath = ejs.render(fileRelativePath, config)
      listOfManipulations = jsonManipulations[fileRelativePath]
      if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
      try {
        contents = fs.readJsonSync(path.join(dstDir, resolvedFileRelativePath))
      } catch (e) {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
        continue
      }

      contents = await utils.manipulateJson(contents, listOfManipulations, config)
      fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), stringify(contents, { space: 2 }))
      // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
    }

    if (!modulePackageJsonValues.component) {
      // Mark it as installed in metadata (create lock file)
      fs.writeFileSync(moduleInstallFile, modulePackageJsonValues.version)
    }

    if (moduleCodeFunctions.postAdd) moduleCodeFunctions.postAdd(config)

    // Module installed!
    if (verbose) console.log('Module installed:', module)
  }
}
