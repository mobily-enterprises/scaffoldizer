const fs = require('fs-extra')
const path = require('path')
const setValue = require('set-value')
const getValue = require('get-value')
const unsetValue = require('unset-value')
const stringify = require('json-stable-stringify')
const ejs = require('ejs')
const { execSync } = require('child_process')
const regexpEscape = require('escape-string-regexp')

exports.prompts = require('prompts')

exports.isDir = function (path) {
  try {
    // Query the entry
    const stats = fs.lstatSync(path)
    if (stats.isDirectory()) return true
    return false
  }
  catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}

exports.isValidHttpUrl = function (string) {
  let url
  try {
    url = new URL(string)
  } catch (e) {
    return false
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
}

exports.resolveScaffold = async function (scaffold, dstDir) {
  // It's a path: use it as path
  if (scaffold.startsWith('./') || scaffold.startsWith('/') || scaffold.includes('/')) {
    console.log('Using direct path for scaffold')
    return scaffold
  }

  // It's not a path: it will assume it's an NPM package, will try to install it
  const nodeModulesScaffoldDir = path.join(dstDir, 'node_modules', scaffold)
  if (exports.isDir(nodeModulesScaffoldDir)) {
    console.log('Scaffold already installed as a node module, using it')
    return nodeModulesScaffoldDir
  } else {
    console.log('Scaffold not yet installed as a node module, running npm install')

    // Run npm-install for scaffold module in the target durectiry
    const startingCwd = process.cwd()
    process.chdir(dstDir)
    execSync(`npm install ${scaffold}`, { stdio: 'inherit' })
    process.chdir(startingCwd)
    return nodeModulesScaffoldDir
  }
}

exports.copyRecursiveSync = function (src, dest, config, baseDestDir) {
  if (!baseDestDir) {
    baseDestDir = dest
    dest = ''
  }
  const exists = fs.existsSync(src)
  const stats = exists && fs.statSync(src)
  const isDirectory = exists && stats.isDirectory()
  if (isDirectory) {
    try {
      fs.mkdirSync(path.join(baseDestDir, dest))
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    for (const childItemName of fs.readdirSync(src)) {
      exports.copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName), config, baseDestDir)
    }
  } else {
    // File already exists: make a backup

    const finalDest = config.moduleCodeFunctions.fileRenamer
      ? config.moduleCodeFunctions.fileRenamer(config, exports.toSep(dest))
      : dest

    if (!finalDest) return
    const exists = fs.existsSync(finalDest)
    const dstStats = exists && fs.statSync(finalDest)
    if (exists && dstStats.isFile()) {
      console.log(`${finalDest} already there, copying required, making a backup`)
      const now = new Date()
      const backupFileName = finalDest + '.' + now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
      fs.renameSync(finalDest, backupFileName)
    }

    fs.copyFileSync(src, path.join(baseDestDir, finalDest))
  }
}

exports.walk = (dir, allFiles, prefixPath = '') => {
  allFiles = allFiles || []
  const files = fs.readdirSync(dir)
  for (const file of files) {
    if (file.startsWith('.') || file === 'node_modules' || file === 'scaffoldizer') continue
    const fullPath = path.join(dir, file)
    if (fs.lstatSync(fullPath).isDirectory()) {
      exports.walk(fullPath, allFiles, path.join(prefixPath, file))
    } else {
      if (path.extname(file) === '.js') allFiles.push(path.join(prefixPath, file))
    }
  }
  return allFiles
}

exports.findAnchorPoints = function (anchorPoint, dir, fileInfoFunction = () => { return {} }) {
  const allFiles = exports.walk(dir)
  const matchingFiles = []
  const regExp = new RegExp(`.*${regexpEscape(anchorPoint)}.*[\n]?`)

  for (const file of allFiles) {
    const contents = fs.readFileSync(path.join(dir, file)).toString()

    if (contents.match(regExp, contents)) {
      const info = fileInfoFunction(contents)
      matchingFiles.push({ file, contents, info })
    }
  }
  return matchingFiles
}

exports.executeManipulations = async (manipulations, config) => {
  const jsonManipulations = manipulations.json || {}
  const textManipulations = manipulations.text || {}

  let listOfManipulations
  let contents
  const dstDir = config.dstDir

  // TEXT MANIPULATIONS
  for (const fileRelativePath in textManipulations) {
    const resolvedFileRelativePath = ejs.render(fileRelativePath, config)
    listOfManipulations = textManipulations[fileRelativePath]
    if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
    try {
      contents = fs.readFileSync(path.join(dstDir, resolvedFileRelativePath)).toString()
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENODIR') {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
      } else {
        throw (e)
      }
      continue
    }
    contents = await exports.manipulateText(contents, listOfManipulations, config)
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
      if (e.code === 'ENOENT' || e.code === 'ENODIR') {
        console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath)
      } else {
        throw (e)
      }
      continue
    }

    contents = await exports.manipulateJson(contents, listOfManipulations, config)
    fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), stringify(contents, { space: 2 }))
    // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
  }
}

exports.capitalize = s => s[0].toUpperCase() + s.slice(1)

exports.toCamelCase = str => exports.capitalize(str
  .toLowerCase()
  .replace(/[-_][a-z]/g, (group) => group.slice(-1).toUpperCase())
)

exports.manipulateText = async function (contents, listOfManipulations, config) {
  let value
  let spaces = ''
  let spacesRegExp
  let spacesMatched
  let f

  for (const m of listOfManipulations) {
    switch (m.op) {
      case 'resolve-ejs':
        contents = ejs.render(contents, config)
        break

      case 'insert':

        value = m.valueFromFile
          ? fs.readFileSync(path.join(config.moduleDir, 'fragments', m.valueFromFile)).toString()
          : m.value

        value = ejs.render(value, config)

        if (m.newlineBefore) value = `\n${value}`
        if (m.newlineAfter) value = `${value}\n`

        spaces = ''
        spacesRegExp = new RegExp(`(.*)${regexpEscape(m.anchorPoint)}`)
        spacesMatched = contents.match(spacesRegExp, contents)
        if (spacesMatched && spacesMatched[1]) spaces = spacesMatched[1]

        if (m.position === 'before') value = `${value}\n${m.anchorPoint}\n`
        else value = `${m.anchorPoint}\n${value}`

        // Add indentation
        if (spaces) {
          value = value.replace(/^/gm, spaces).replace(/(.*)$[\s]*$/, '')
        }

        contents = contents.replace(new RegExp(`.*${regexpEscape(m.anchorPoint)}.*[\n]?`), value)
        break

      case 'deleteText':
        contents = contents.replace(new RegExp(m.deleteRegexp, m.deleteRegexpOptions || ''), '')
        break

      case 'custom':
        f = config.scaffoldUtilsFunctions[m.function]
        if (!f) {
          throw new Error(`Function ${m.function} must be defined in scaffold's utils.js`)
        }
        contents = await f(contents, m, config)
        break
      default:
        throw new Error(`Invalid op: ${m.op}`)
    }
  }
  return contents
}

exports.manipulateJson = async function (obj, listOfManipulations, config) {
  obj = JSON.parse(stringify(obj))
  let value
  let $t

  for (const m of listOfManipulations) {
    //
    // Resolve the value as EJS  if it's a string
    if (typeof m.value === 'string') value = ejs.render(m.value, config)
    else value = m.value

    switch (m.op) {
      case 'setIfNotThere':
        if (typeof getValue(obj, m.key) === 'undefined') setValue(obj, m.key, value)
        break

      case 'set':
        setValue(obj, m.key, value)
        break

      case 'unset':
        unsetValue(obj, m.key)
        break
      case 'pushIfNotThere':
      case 'push':
        $t = getValue(obj, m.key)
        if (!Array.isArray($t)) {
          $t = []
          setValue(obj, m.key, $t)
        }
        if (m.op === 'push' || $t.indexOf(value) === -1) $t.push(value)
        break
      case 'pull':
        $t = getValue(obj, m.key)
        if (Array.isArray($t)) {
          const index = $t.indexOf(value)
          if (index !== -1) $t.splice(index, 1)
        }
        break
      default:
        console.log('Invalid operation in object manipulation:', m.op)
    }
  }
  return obj
}

exports.toSep = s => s.replace(/\\/g, '/')
