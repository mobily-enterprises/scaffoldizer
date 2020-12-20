const fs = require('fs-extra')
const path = require('path')
const utils = require('../lib/utils')
const stringify = require('json-stable-stringify')
const prompts = require('prompts')
const ejs = require('ejs')

exports = module.exports = async (scaffold, dstDir, modules) => {
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
  const installedModules = {}
  if (!modules.length) {
    const scaffoldModulesDir = path.join(scaffoldDir, 'modules')
    const moduleDirs = fs.readdirSync(scaffoldModulesDir, { withFileTypes: true })
    for (const dirEnt of moduleDirs) {
      if (dirEnt.isDirectory()) {
        // console.log(dirEnt.name)
        const modulePackageJsonValues = fs.readJsonSync(path.join(scaffoldModulesDir, dirEnt.name, 'module.json'))
        if (modulePackageJsonValues.shortListed) {
          shortListChoices.push({
            title: modulePackageJsonValues.name,
            description: modulePackageJsonValues.description,
            value: modulePackageJsonValues.name,
            shortListPosition: modulePackageJsonValues.shortListPosition
          })
        }
        let dependencies = ''
        if (Array.isArray(modulePackageJsonValues.moduleDependencies) && modulePackageJsonValues.moduleDependencies.length) {
          dependencies = `, depends on: ${modulePackageJsonValues.moduleDependencies.join(', ')}`
        } else {
          dependencies = ', no dependencies'
        }
        if (!modulePackageJsonValues.shortListed) {
          choices.push({
            title: modulePackageJsonValues.name,
            description: `${modulePackageJsonValues.description}${dependencies}}`,
            value: modulePackageJsonValues.name,
            position: modulePackageJsonValues.position
          })
        }

        if (fs.existsSync(path.join(dstScaffoldizerInstalledDir, dirEnt.name))) {
          installedModules[dirEnt.name] = true
        }
      }
    }

    shortListChoices = shortListChoices
      .sort((a, b) => Number(a.shortListPosition) - Number(b.shortListPosition))
      .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      // .filter(choice => Number(choice.shortListPosition) !== -1)

    choices = choices
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map(choice => { return { ...choice, disabled: installedModules[choice.value] } })
      // .filter(choice => Number(choice.position) !== -1)

    shortListChoices.push({
      title: 'Pick individual modules',
      value: '__INDIVIDUAL__'
    })

    shortListChoices.push({
      title: 'Install ',
      value: '__COMPONENTS__'
    })

    modules = (await prompts({
      type: 'select',
      name: 'value',
      message: 'pick a module to install',
      choices: shortListChoices
    }, { onCancel: onPromptCancel })).value
  }

  if (modules === '__INDIVIDUAL__') {
    modules = (await prompts({
      type: 'multiselect',
      name: 'value',
      message: 'pick a module to install',
      choices
    }, { onCancel: onPromptCancel })).value
  }

  if (!Array.isArray(modules)) modules = [modules]
  for (const module of modules) await installModule(module)

  async function installModule (module) {
    const moduleDir = path.join(scaffoldDir, 'modules', module)
    const moduleInstallFile = path.join(dstScaffoldizerInstalledDir, module)

    // Check if module is available
    if (!utils.isDir(moduleDir)) {
      console.log(`FATAL: Kit not found: ${module}`)
      process.exit(1)
    }

    // Check if module is already installed
    if (fs.existsSync(moduleInstallFile)) {
      console.log(`${module} already installed, skipping...`)
      return
    }

    // Install dependendencies first

    const modulePackageJson = path.join(moduleDir, 'module.json')
    if (!fs.existsSync(modulePackageJson)) {
      console.log(`FATAL: Module is missing the package.json file: ${module}`)
      process.exit(1)
    }
    const modulePackageJsonValues = fs.readJsonSync(modulePackageJson)

    const config = {
      moduleDir,
      moduleInstallFile,
      dstDir,
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      dstScaffoldizerRemotesDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
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
      if ($h) console.log($h)
      userInput[module] = await prompts($p, { onCancel: onPromptCancel })
    }

    const deps = modulePackageJsonValues.moduleDependencies || []
    if (deps.length) console.log('This module has dependencies. Installing them.', deps)
    for (const module of deps) {
      await installModule(module)
    }
    if (deps.length) console.log('Dependencies installed.', deps)

    // Actually installing the module!
    console.log('Installing:', module)

    if (moduleCodeFunctions.preAdd) moduleCodeFunctions.preAdd(config)

    const moduleDistrDir = path.join(moduleDir, 'distr')
    if (utils.isDir(moduleDistrDir)) {
      console.log('"distr" folder found, copying files over')
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
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
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

      // If it can be installed more than once, don't mark it as installed at all
      if (!modulePackageJson.multiInstall) {
        contents = await utils.manipulateJson(contents, listOfManipulations, config)
        fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), stringify(contents, { space: 2 }))
      }

      // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
    }

    // Mark it as installed in metadata (create lock file)
    fs.writeFileSync(moduleInstallFile, modulePackageJsonValues.version)

    if (moduleCodeFunctions.postAdd) moduleCodeFunctions.postAdd(config)

    // Module installed!
    console.log('Module installed:', module)
  }
}
