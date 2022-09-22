import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import dotenv from 'dotenv'
import { JMAP_CORE_URI, MASKED_EMAIL_URI } from '../lib/constants.js'
import { FastmailApi } from '../lib/FastmailApi.js'

dotenv.config()

async function main() {
  const fastmail = await FastmailApi.create(process.env.FASTMAIL_API_TOKEN)

  const maskedEmails = await getMaskedEmails(fastmail)
  const toUpdate = await edit(maskedEmails)

  const count = Object.keys(toUpdate).length
  if (count > 0) {
    console.log(`updating ${ count } masked emails`)
    await updateMaskedEmails(fastmail, toUpdate)
  } else {
    console.log('nothing to update')
  }
}

async function getMaskedEmails(fastmail) {
  const response = await fastmail.call({
    using: [JMAP_CORE_URI, MASKED_EMAIL_URI],
    methodCalls: [
      ['MaskedEmail/get', {
        accountId: fastmail.getPrimaryAccount(MASKED_EMAIL_URI),
      }, 'a']
    ],
  })

  const maskedEmails = [...response.methodResponses[0][1].list]
  maskedEmails.sort((a, b) => a.email.localeCompare(b.email))
  return maskedEmails
}

async function updateMaskedEmails(fastmail, toUpdate) {
  const response = await fastmail.call({
    using: [JMAP_CORE_URI, MASKED_EMAIL_URI],
    methodCalls: [
      ['MaskedEmail/set', {
        accountId: fastmail.getPrimaryAccount(MASKED_EMAIL_URI),
        update: toUpdate,
      }, 'a']
    ],
  })

  console.log(response.methodResponses[0][1])
}

async function edit(maskedEmails) {
  const serialized = maskedEmails
    .map(toString)
    .map((email, index) => `[${ index + 1 }/${ maskedEmails.length }] ${ email }`)
    .join('\n\n')
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jmap-client--'))
  const tmpFile = path.join(tmpDir, 'masked-emails.txt')
  await writeFile(tmpFile, serialized)
  await editFile(tmpFile)
  const data = await readFile(tmpFile, { encoding: 'UTF-8' })
  await rm(tmpFile)
  await rmdir(tmpDir)
  return parse(data, maskedEmails)
}

function editFile(file) {
  return new Promise((resolve, reject) => {
    const editor = spawn(process.env.EDITOR || 'vim', [file], {
      stdio: 'inherit',
      detached: true,
    })

    editor.on('error', (error) => {
      reject(error)
    })

    editor.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(code)
      }
    })
  })
}

function toString(maskedEmail) {
  return fmt`
    ${ maskedEmail.email } (id: ${ maskedEmail.id })
      description: ${ maskedEmail.description }
      forDomain: ${ maskedEmail.forDomain }
      url: ${ maskedEmail.url ?? '' }
  `
}

function fmt(strs, ...vars) {
  let str = strs[0]

  for (let i = 0; i < vars.length; i += 1) {
    str += vars[i] + strs[i + 1]
  }

  let indent = null
  return str
    .split('\n')
    .filter(Boolean)
    .map(line => {
      if (indent === null) {
        indent = line.replace(/^(\s*).*$/, '$1')
      }
      return line.replace(indent, '')
    })
    .filter(line => !line.match(/^\s*$/))
    .join('\n')
    .trim()
}

function parse(data, maskedEmails) {
  const toUpdate = {}
  let i = 0
  let id = null
  let maskedEmail = {}

  const add = () => {
    if (id !== null) {
      // skip ahead to the correct entry -- assume the order did not change
      while (maskedEmails[i].id !== id) {
        i += 1
      }

      if (hasChanged(maskedEmails[i], maskedEmail)) {
        toUpdate[id] = maskedEmail
      }

      id = null
      maskedEmail = {}
    }
  }

  for (const line of data.split('\n')) {
    const headerMatch = line.match(/^\S.* \(id: (\S+)\)$/)
    if (headerMatch) {
      add()
      id = headerMatch[1]
    }

    const match = line.match(/^\s*(\S+):\s*(.*)$/)
    if (match) {
      if (match[1] === 'url' && match[2] === '') {
        maskedEmail.url = null
      } else {
        maskedEmail[match[1]] = match[2]
      }
    }
  }

  add()

  return toUpdate
}

function hasChanged(a, b) {
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) return true
  }
  return false
}

main().catch(console.error)
