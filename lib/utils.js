const fs = require('fs-extra')
const path = require('path')
const setValue = require('set-value')
const getValue = require('get-value')
const unsetValue = require('unset-value')
const stringify = require('json-stable-stringify')
const ejs = require('ejs')
const { execSync } = require('child_process')
const regexpEscape = require('escape-string-regexp')
const debug = require('debug')('logs')

exports.prompts = require('prompts')


exports.prompt = async (question) => {
  const q = { ...question, name: 'value' }

  const answer = (await exports.prompts(q)).value
  return answer
}

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

exports.copyRecursiveSync = function (config, src, dest, baseDestDir) {
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
      exports.copyRecursiveSync(config, path.join(src, childItemName), path.join(dest, childItemName), baseDestDir)
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

    fs.mkdirSync(path.join(baseDestDir, path.dirname(finalDest)), { recursive: true })
    fs.copyFileSync(src, path.join(baseDestDir, finalDest))
    console.log(`> ${finalDest}`)
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

exports.injectPlaceholder = (template, file, textToBeAdded) => {

  function countLastLineIndents(inputString) {
    const lines = inputString.trim().split('\n');
    const lastLine = lines.pop()

    let indentCount = lastLine.match(/^\s*/)[0].length;
    
    const lastChar = lastLine[lastLine.length - 1]
    if (['[','`', '{'].includes(lastChar)) indentCount += 2
  
    return indentCount;
  }



  const indentStringBySpaces = (inputString, indentCount) =>
  inputString
    .split('\n')
    .map(line => !line.trim() ? line : (' '.repeat(indentCount) + line))
    .join('\n');
    
  const escapedTemplate = template

    // Escape all special characters in the set
    .replace(/[-\/\\^$*+?.()|{}[\]~]/g, "\\$&")

    .replace(/(\s?)\\\.\\\.\\\.\\\.\\\.(\s?)/g, ".*")

    // The (now escaped) "..." must mean "any characters"
    .replace(/(\s?)\\\.\\\.\\\.(\s?)/g, ".*?")


    // The (now escaped) "***" must mean "any characters", since
    // it will contain the placeholder
    .replace(/\\\*\\\*\\\*/g, ")(")

    // Spaces are generalised
    .replace(/ +/g, "\\s+");

  // Add grouping for what comes before and what comes after
  const templateRegex = new RegExp('(' + escapedTemplate + ')', 's');
  debug('Template regex for placeholder injection: ', templateRegex)

  // If there is a match, return the slices. Otherwise,
  // return the original file
  const match = file.match(templateRegex);
  // debug('Match result: ', match)

  if (match) {

    // debug('text to be added:', textToBeAdded)
    // debug('MATCH 5:', match[5].substr(0,10))
    
    const indents = countLastLineIndents(match[1])
    return match[1] + indentStringBySpaces(textToBeAdded, indents) + match[2]
    // return match[1] + match[2] + textToBeAdded + match[4] + match[5]
  } else {
    return file;
  }
}

exports.getFiles = function (config, filter, fileInfoFunction = () => { return {} } ) {
  const allFiles = exports.walk(config.dstDir);
  const matchingFiles = [];
  
  for (const file of allFiles) {
    const contents = fs.readFileSync(path.join(config.dstDir, file)).toString()

    const info = fileInfoFunction(contents)

    let filterReturn; // Variable declaration added here

    if (typeof filter === 'function') {
      filterReturn = filter(info, contents); // Assigning value to filterReturn
    } else if (filter instanceof RegExp) {
      const match = filter.exec(contents); // Using RegExp.exec() to get the first match and its groups
      filterReturn = match ? match[1] : null // Assigning the first captured group to filterReturn or null if there is no match
    } else {
      filterReturn = true
    }

    if (filterReturn) { 
      matchingFiles.push({
        file,
        contents,
        info
      })
    }
  }

  return matchingFiles;
}


exports.executeManipulations = async (config, manipulations) => {
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
    if (resolvedFileRelativePath) {
      try {
        contents = fs.readFileSync(path.join(dstDir, resolvedFileRelativePath)).toString()
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENODIR') {
          console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath, resolvedFileRelativePath)
        } else {
          throw (e)
        }
        continue
      }
      contents = await exports.manipulateText(config, contents, listOfManipulations)
      fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), contents)
    }
  }

  // JSON MANIPULATIONS
  for (const fileRelativePath in jsonManipulations) {
    const resolvedFileRelativePath = ejs.render(fileRelativePath, config)
    listOfManipulations = jsonManipulations[fileRelativePath]
    if (typeof list === 'object') listOfManipulations = [listOfManipulations[0]]
    if (resolvedFileRelativePath) {
      try {
        contents = fs.readJsonSync(path.join(dstDir, resolvedFileRelativePath))
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENODIR') {
          console.error('Destination file to manipulate does not exist in target directory:', fileRelativePath, resolvedFileRelativePath)
        } else {
          throw (e)
        }
        continue
      }
    }
    contents = await exports.manipulateJson(config, contents, listOfManipulations)
    fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), stringify(contents, { space: 2 }))
    // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
  }
}

exports.capitalize = s => s[0].toUpperCase() + s.slice(1)

exports.toCamelCase = str => exports.capitalize(str
  .toLowerCase()
  .replace(/[-_][a-z]/g, (group) => group.slice(-1).toUpperCase())
)

exports.manipulateText = async function (config, contents, listOfManipulations) {
  let value
  let spaces = ''
  let spacesRegExp
  let spacesMatched
  let f
  let anchorPoint

  debug('Running manipulations for', config.moduleJson5Values.name,'...')
  for (const m of listOfManipulations) {
    // If an "if" is defined, and fails, don't run the transformation
    if (typeof m.if !== 'undefined') {
      if (ejs.render(m.if, config) !== 'true') {
        debug('Condition NOT satisfied:', m.if)
        continue
      } else {
        debug('Condition was satisfied:', m.if)
      }
    }

    switch (m.op) {
      case 'resolve-ejs':
        contents = ejs.render(contents, config)
        break

      case 'insert':
        debug('Inserting a value in the destination file')
        if (m.valueFromFile) debug('Value will be a fragment from a file')
        value = m.valueFromFile
          ? fs.readFileSync(path.join(config.moduleDir, 'fragments', m.valueFromFile)).toString()
          : m.value

        // value = value.trim()
        // debug('Value before rendering:', value)

        value = ejs.render(value, config)
        // debug('Value after rendering:', value)

        anchorPoint = ejs.render(m.anchorPoint, config)

        debug('Anchor point (template):', anchorPoint)

        if (m.newlineBefore) value = `\n${value}`
        if (m.newlineAfter) value = `${value}\n`

        // debug('Contents before injection:', contents)
        //  await exports.prompt({type: 'confirm', message: 'Next?'})
        debug('Trying to inject:', value)


        
        contents = exports.injectPlaceholder(anchorPoint, contents, value)

        debug('Contents after injection:', contents)

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

exports.manipulateJson = async function (config, obj, listOfManipulations) {
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

exports.loadModuleValues = (config, module) => {
  const moduleInstallFile = path.join(config.dstScaffoldizerInstalledDir, module)
  if (!fs.existsSync(moduleInstallFile)) {
    return null
  }

  return fs.readJsonSync(moduleInstallFile)
}

exports.toSep = s => s.replace(/\\/g, '/')
