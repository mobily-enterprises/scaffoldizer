const fs = require('fs-extra')
const path = require('path')
const utils = require('../lib/utils')
const prompts = require('prompts')
const { program } = require('commander')
const JSON5 = require('json5')

const onPromptCancel = (prompt) => {
  console.error('Aborting...')
  process.exit(1)
}

/*
 * **************************************************************
 * Add function (UI)
 * **************************************************************
 */
exports.run = async (scaffold, dstDir, script) => {
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

    script = (await prompts({
      type: 'select',
      name: 'value',
      message: 'Pick a script to run',
      choices: scriptsToPick
    }, { onCancel: onPromptCancel })).value

    let config = {
      dstDir,
      dstScaffoldizerDir,
      dstScaffoldizerInstalledDir,
      dstPackageJsonValues,
      scaffoldPackageJsonValues,
      scaffoldUtilsFunctions,
      utils,
      scaffoldDir,
      vars
    }

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
      scriptCodeFunctions = require(path.resolve(scriptCode))
    }
    config.scriptCodeFunctions = scriptCodeFunctions

    let userInput = {}
    if (scriptCodeFunctions.prePrompts) {
      const $r = await scriptCodeFunctions.prePrompts(config)
      if ($r === false) return false
    }

    if (scriptCodeFunctions.getPrompts) {
      if (verbose) console.log('Getting script prompts.')
      // Note: getPrompts might set values in  userInput[module] programmatically
      const $p = scriptCodeFunctions.getPrompts(config)
      if ($p === false) return false
      let $h
      if (scriptCodeFunctions.getPromptsHeading) $h = scriptCodeFunctions.getPromptsHeading()
      if ($h) console.log(`\n${$h}\n`)

      const answers = await prompts($p, { onCancel: onPromptCancel })
      userInput = answers
    }
    config.userInput = userInput

    if (verbose) console.log(`Running ${script} ${config}...`)
    scriptCodeFunctions.script(config)
  }
}
