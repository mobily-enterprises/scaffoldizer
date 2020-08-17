const fs = require('fs')
const path = require('path')
const setValue = require('set-value')
const getValue = require('get-value')
const unsetValue = require('unset-value')
const stringify = require('json-stable-stringify')
const ejs = require('ejs')

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

exports.resolveScaffold = function (scaffold, dstDir) {
  // TODO: If it's a  URL, then:
  // - check if it's already downloaded in destination folder
  // - if it's not, do so with axios
  // - return the inner directory
  return scaffold
}

exports.copyRecursiveSync = function (src, dest, force = true) {
  const exists = fs.existsSync(src)
  const stats = exists && fs.statSync(src)
  const isDirectory = exists && stats.isDirectory()
  if (isDirectory) {
    try {
      fs.mkdirSync(dest)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    for (const childItemName of fs.readdirSync(src)) {
      exports.copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName), force)
    }
  } else {
    // MAYBE rename original file
    const exists = fs.existsSync(dest)
    const dstStats = exists && fs.statSync(dest)

    // File already exists: only copy it if it's required
    if (exists && dstStats.isFile()) {
      if (force) {
        console.log(`${dest} already there, copying required, making a backup`)
        const now = new Date()
        const backupFileName = dest + '.' + now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
        fs.renameSync(dest, backupFileName)
        fs.copyFileSync(src, dest)
      } else {
        console.log(`${dest} already there, copying not required, skipping`)
      }

    // File does not exist: copy it regardless
    } else {
      fs.copyFileSync(src, dest)
    }
  }
}

exports.manipulateText = async function (contents, listOfManipulations, config) {
  let value
  for (const m of listOfManipulations) {
    switch (m.op) {
      case 'insert':

        if (m.valueFromFile) {
          value = m.valueFromFile
            ? fs.readFileSync(path.join(config.moduleDir, 'fragments', m.valueFromFile)).toString()
            : m.value
        }

        value = ejs.render(value, config)

        if (m.newlineBefore) value = `\n${value}`
        if (m.newlineAfter) value = `${value}\n`

        if (m.position === 'before') value = `${value}${m.anchorPoint}`
        else value = `${m.anchorPoint}${value}`

        contents = contents.replace(m.anchorPoint, value)
        break
    }
  }
  return contents
}

exports.manipulateJson = async function (obj, listOfManipulations, config) {
  obj = JSON.parse(stringify(obj))
  let value

  for (const m of listOfManipulations) {
    if (m.value) value = ejs.render(m.value, config)
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
        // TODO
        break
      case 'push':
        // TODO
        break
      case 'pull':
        // TODO
        break
      default:
        console.log('Invalid operation in object manipulation:', m.op)
    }
  }
  return obj
}
