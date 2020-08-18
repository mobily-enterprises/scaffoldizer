const fs = require('fs-extra')
const path = require('path')
const utils = require('../lib/utils')
const stringify = require('json-stable-stringify')
const prompts = require('prompts')

exports = module.exports = async (scaffold, module, dstDir) => {
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

  const userInput = {}
  installModule(module)

  async function installModule (module) {
    const moduleDir = path.join(scaffoldDir, 'modules', module)
    const moduleInstallFile = path.join(dstScaffoldizerInstalledDir, 'moduleName')

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
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      dstScaffoldizerRemotesDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
      modulePackageJsonValues,
      userInput
    }

    // Include code
    const moduleCode = path.join(moduleDir, 'code.js')
    let moduleCodeFunctions = {}
    if (fs.existsSync(moduleCode)) {
      moduleCodeFunctions = require(path.resolve(moduleCode))
    }

    if (moduleCodeFunctions.prePrompts) moduleCodeFunctions.prePrompts(config)

    if (moduleCodeFunctions.getPrompts) {
      const $p = moduleCodeFunctions.getPrompts(config)
      let $h
      if (moduleCodeFunctions.getPromptsHeading) $h = moduleCodeFunctions.getPromptsHeading()
      if ($h) console.log($h)
      userInput[module] = await prompts($p)
    }

    const deps = modulePackageJsonValues.moduleDependencies || []
    if (deps.length) console.log('This module has dependencies. Installing them.', deps)
    for (const moduleName of deps) {
      installModule(moduleName)
    }
    if (deps.length) console.log('Dependencies installed.', deps)

    // Actually installing the module!
    console.log('Installing:', module)

    if (moduleCodeFunctions.preAdd) moduleCodeFunctions.preAdd(config)

    const moduleDistrDir = path.join(moduleDir, 'distr')
    if (utils.isDir(moduleDistrDir)) {
      console.log('"distr" folder found, copying files over')
      utils.copyRecursiveSync(moduleDistrDir, dstDir, true)
    }

    const moduleDistrOptDir = path.join(moduleDir, 'distr-opt')
    if (utils.isDir(moduleDistrOptDir)) {
      console.log('"distr-opt" folder (optional files) found, copying files over')
      utils.copyRecursiveSync(moduleDistrOptDir, dstDir, false)
    }

    // Carry ong requested inserts in destination files
    const manipulations = modulePackageJsonValues.manipulate || {}
    const jsonManipulations = manipulations.json || {}
    const textManipulations = manipulations.text || {}

    let listOfManipulations
    let contents

    // TEXT MANIPULATIONS
    for (const fileRelativePath in textManipulations) {
      listOfManipulations = textManipulations[fileRelativePath]
      if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
      try {
        contents = fs.readFileSync(path.join(dstDir, fileRelativePath)).toString()
      } catch (e) {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
        continue
      }
      contents = await utils.manipulateText(contents, listOfManipulations, config)
      fs.writeFileSync(path.join(dstDir, fileRelativePath), contents)
    }

    // JSON MANIPULATIONS
    for (const fileRelativePath in jsonManipulations) {
      listOfManipulations = jsonManipulations[fileRelativePath]
      if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
      try {
        contents = fs.readJsonSync(path.join(dstDir, fileRelativePath))
      } catch (e) {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
        continue
      }
      contents = await utils.manipulateJson(contents, listOfManipulations, config)
      fs.writeFileSync(path.join(dstDir, fileRelativePath), stringify(contents, { space: 2 }))
      // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
    }

    // Mark it as installed in metadata (create lock file)
    fs.writeFileSync(moduleInstallFile, modulePackageJsonValues.version)

    if (moduleCodeFunctions.postAdd) moduleCodeFunctions.postAdd(config)

    // Module installed!
    console.log('Module installed:', module)
  }
}
