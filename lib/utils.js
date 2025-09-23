import fs from 'fs-extra'
import path from 'path'
import setValue from 'set-value'
import getValue from 'get-value'
import unsetValue from 'unset-value'
import stringify from 'json-stable-stringify'
import ejs from 'ejs'
import { execSync } from 'child_process'
import regexpEscape from 'escape-string-regexp'
import debugLib from 'debug'

const debug = debugLib('logs')

import promptsLib from 'prompts'
export const prompts = promptsLib

export const prompt = async (question) => {
  const q = { ...question, name: 'value' }

  const answer = (await prompts(q)).value
  return answer
}

export const isDir = function (path) {
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

export const isValidHttpUrl = function (string) {
  let url
  try {
    url = new URL(string)
  } catch (e) {
    return false
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
}

export const resolveScaffold = async function (scaffold, dstDir) {
  // It's a path: use it as path
  if (scaffold.startsWith('./') || scaffold.startsWith('/') || scaffold.includes('/')) {
    console.log('Using direct path for scaffold')
    return scaffold
  }

  // It's not a path: it will assume it's an NPM package, will try to install it
  const nodeModulesScaffoldDir = path.join(dstDir, 'node_modules', scaffold)
  if (isDir(nodeModulesScaffoldDir)) {
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

export const copyRecursiveSync = function (config, src, dest, baseDestDir) {
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
      copyRecursiveSync(config, path.join(src, childItemName), path.join(dest, childItemName), baseDestDir)
    }
  } else {
    // File already exists: make a backup

    let finalDest = config.moduleCodeFunctions.fileRenamer
      ? config.moduleCodeFunctions.fileRenamer(config, toSep(dest))
      : dest

    if (finalDest !== false) {
      if (!finalDest) finalDest = dest

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
}

export const walk = (dir, allFiles, prefixPath, exts) => {
  allFiles = allFiles || []
  prefixPath = prefixPath || ''
  const files = fs.readdirSync(dir)
  for (const file of files) {
    if (file.startsWith('.') || file === 'node_modules' || file === 'scaffoldizer') continue
    const fullPath = path.join(dir, file)
    if (fs.lstatSync(fullPath).isDirectory()) {
      walk(fullPath, allFiles, path.join(prefixPath, file), exts)
    } else {
      if (!exts || exts.indexOf(path.extname(file)) !== -1) {
        allFiles.push(path.join(prefixPath, file))
      }
    }
  }
  return allFiles
}

export const injectPlaceholder = (template, file, textToBeAdded, insertBelow) => {
  function insertFragment (code, pos, fragment, insertBelow) {
    const codeLines = code.split('\n')

    let lengthTally = 0
    let linePos
    for (let i = 0, l = codeLines.length; i < l; i++) {
      const line = codeLines[i]
      lengthTally += line.length + 1
      // console.log(lengthTally, '**' + line + '**')
      if (lengthTally >= pos) {
        linePos = i
        break
      }
    }

    if (insertBelow) linePos++

    // Chase the first non-empty line
    let prevLinePos = linePos ? linePos - 1 : linePos
    for (; prevLinePos >= 0; prevLinePos--) {
      if (codeLines[prevLinePos].length) break
    }

    // Maybe add extra indent, depending on what was in the line before
    let extraIndent = ''
    const prevLine = codeLines[prevLinePos]
    if (prevLine.length) {
      if (['[', '`', '{'].includes(prevLine[prevLine.length - 1])) extraIndent = '  '
    }

    const tabMatch = codeLines[prevLinePos].match(/^[\t ]*/)
    const prevLineIndent = tabMatch ? tabMatch[0] : ''

    const fragmentLines = fragment.split('\n').map(l => prevLineIndent + extraIndent + l)

    codeLines.splice(linePos, 0, ...fragmentLines)
    return codeLines.join('\n')
  }

  const escapedTemplate = (
    template

      // Escape all special characters in the set
      .replace(/[-\/\\^$*+?.()|{}[\]~]/g, "\\$&")

      .replace(/(\s?)\\\.\\\.\\\.\\\.\\\.(\s?)/g, ".*")

      // The (now escaped) "..." must mean "any characters"
      .replace(/(\s?)\\\.\\\.\\\.(\s?)/g, ".*?")

      // The (now escaped) "..." must mean "any characters in the same line"
      .replace(/(\s?)\\\.\\\.(\s?)/g, "[^\n]*?")

      // The (now escaped) "***" must mean "any characters", since
      // it will contain the placeholder
      .replace(/\\\*\\\*\\\*/g, ")(")

      // Spaces are generalised
      .replace(/ +/g, "\\s+")
  ) + '$'

  // Add grouping for what comes before and what comes after
  const templateRegex = new RegExp('(' + escapedTemplate + ')', 's')
  debug('Template regex for placeholder injection: ', templateRegex)

  // If there is a match, return the slices. Otherwise,
  // return the original file
  const match = file.match(templateRegex)
  // debug('Match result: ', match)

  if (!match) {
    console.error('WARNING!!!!!!! Could not find match!', template)
    return file
  }

  return insertFragment(file, match[1].length, textToBeAdded, insertBelow)
}
export const file2Info = async function (config, file, fileInfoFunction) {
  const contents = fs.readFileSync(path.join(config.dstDir, file)).toString()
  return fileInfoFunction(contents, file)
}

export const getFiles = async function (config, filter, fileInfoFunction = () => { return {} }, exts) {
  const allFiles = walk(config.dstDir, null, null, exts)
  const matchingFiles = []

  for (const file of allFiles) {
    const contents = fs.readFileSync(path.join(config.dstDir, file)).toString()

    const info = await file2Info(config, file, fileInfoFunction)

    let filterReturn // Variable declaration added here

    if (typeof filter === 'function') {
      filterReturn = filter(info, contents) // Assigning value to filterReturn
    } else if (filter instanceof RegExp) {
      const match = filter.exec(contents) // Using RegExp.exec() to get the first match and its groups
      filterReturn = match ? match[1] : null // Assigning the first captured group to filterReturn or null if there is no match
    } else {
      filterReturn = true
    }

    if (filterReturn) {
      matchingFiles.push({
        file,
        contents,
        ...info
      })
    }
  }

  return matchingFiles
}

export const executeManipulations = async (config, manipulations) => {
  const jsonManipulations = manipulations.json || {}
  const textManipulations = manipulations.text || {}

  let listOfManipulations
  let contents
  const dstDir = config.dstDir

  // TEXT MANIPULATIONS
  for (const fileRelativePath in textManipulations) {
    const resolvedFileRelativePath = ejs.render(fileRelativePath, config)
    if (!resolvedFileRelativePath) continue // Empty file, skip it
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
      contents = await manipulateText(config, contents, listOfManipulations)
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
    contents = await manipulateJson(config, contents, listOfManipulations)
    fs.writeFileSync(path.join(dstDir, resolvedFileRelativePath), stringify(contents, { space: 2 }))
    // fs.writeJsonSync(path.join(dstDir, fileRelativePath), contents, { spaces: 2 })
  }
}

export const capitalize = s => s[0].toUpperCase() + s.slice(1)

export const toCamelCase = str => capitalize(str
  .toLowerCase()
  .replace(/[-_][a-z]/g, (group) => group.slice(-1).toUpperCase())
)

export const manipulateText = async function (config, contents, listOfManipulations) {
  let value
  let f
  let anchorPoint

  debug('Running manipulations for', config.moduleJson5Values.name, '...')
  // console.log('About to do manipulations:', listOfManipulations.map(m => m.if).join(','))
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

      case 'replace':
        if (m.findRegexp) {
          contents = contents.replace(new RegExp(m.findRegexp, 'g'), m.replaceString)
        } else {
          contents = contents.split(m.findString).join(m.replaceString)
        }
        break

      case 'insert':
        debug('Inserting a value in the destination file')
        if (m.valueFromFile) debug('Value will be a fragment from a file')
        value = m.valueFromFile
          ? fs.readFileSync(path.join(config.moduleDir, 'fragments', m.valueFromFile)).toString()
          : m.value

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

        contents = injectPlaceholder(anchorPoint, contents, value, m.insertBelow)

        debug('Contents after injection:', contents)

        break

      case 'deleteText':
        contents = contents.replace(new RegExp(m.deleteRegexp, m.deleteRegexpOptions || ''), '')
        break

      case 'append':
        value = m.valueFromFile
          ? fs.readFileSync(path.join(config.moduleDir, 'fragments', m.valueFromFile)).toString()
          : m.value

        value = ejs.render(value, config)

        // Check if contents ends with a newline, if not add one before appending
        if (contents.length > 0 && !contents.endsWith('\n')) {
          contents += '\n'
        }
        contents += value
        break

      case 'custom':
        f = config.scaffoldUtilsFunctions[m.function]
        if (!f) {
          throw new Error(`Function ${m.function} must be defined in scaffold's utils.js`)
        }
        contents = await f(contents, m, config, { prompts, prompt, isDir, isValidHttpUrl, resolveScaffold, copyRecursiveSync, walk, injectPlaceholder, file2Info, getFiles, executeManipulations, capitalize, toCamelCase, manipulateText, manipulateJson, loadModuleValues, toSep })
        break
      default:
        throw new Error(`Invalid op: ${m.op}`)
    }
  }
  return contents
}

export const manipulateJson = async function (config, obj, listOfManipulations) {
  obj = JSON.parse(stringify(obj))
  let value
  let $t

  for (const m of listOfManipulations) {

    // Resolve key and value as EJS if it's a string
    if (typeof m.value === 'string') m.value = ejs.render(m.value, config)
    if (typeof m.key === 'string') m.key = ejs.render(m.key, config)
        
    const value = m.value
    switch (m.op) {
      case 'setIfNotThere':
        if (typeof getValue(obj, m.key) === 'undefined') setValue(obj, m.key, value)
        break

      case 'set':
        setValue(obj, m.key, value, { preservePaths: false })
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

export const loadModuleValues = (config, module) => {
  const moduleInstallFile = path.join(config.dstScaffoldizerInstalledDir, module)
  if (!fs.existsSync(moduleInstallFile)) {
    return null
  }

  return fs.readJsonSync(moduleInstallFile)
}

export const toSep = s => s.replace(/\\/g, '/')
