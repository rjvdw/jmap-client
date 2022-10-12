import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import dotenv from 'dotenv'
import { JMAP_CORE_URI, MASKED_EMAIL_URI } from '../lib/constants.js'
import { FastmailApi } from '../lib/FastmailApi.js'
import { run } from '../lib/process.js'
import { Git } from '../lib/Git.js'

const FILE_NAME = 'masked-emails.txt'

dotenv.config()

async function main() {
  const fastmail = await FastmailApi.create(process.env.FASTMAIL_API_TOKEN)

  const maskedEmails = await getMaskedEmails(fastmail)
  const toUpdate = await edit(maskedEmails)

  const count = Object.keys(toUpdate).length
  if (count > 0) {
    console.debug('updating %s masked emails', count)
    await updateMaskedEmails(fastmail, toUpdate)
  } else {
    console.debug('nothing to update')
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
  // maskedEmails.sort((a, b) => a.email.localeCompare(b.email))
  maskedEmails.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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

  console.debug(response.methodResponses[0][1])
}

async function edit(maskedEmails) {
  const serialized = maskedEmails
    .map(toString)
    .map((email, index) => `[${ index + 1 }/${ maskedEmails.length }] ${ email }`)
    .join('\n\n')

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jmap-client--'))
  console.debug('created working dir: "%s"', tmpDir)
  const tmpFile = path.join(tmpDir, FILE_NAME)

  const { GIT_REMOTE } = process.env
  const git = Git.create(tmpDir)
  const hasChanges = async () => Boolean((await git.status('--porcelain')).trim())

  if (GIT_REMOTE) {
    await git.clone(GIT_REMOTE, '.')
    console.debug('cloned git repository from %s', GIT_REMOTE)
  } else {
    await git.init()
    console.debug('set up git repository')
  }

  await writeFile(tmpFile, serialized)
  console.debug('created working file: "%s"', tmpFile)
  if (!GIT_REMOTE || await hasChanges()) {
    await git.add(FILE_NAME)
    await git.commit('-m', 'Sync masked e-mails from Fastmail')
  }

  // console.debug('opening shell')
  // await openShell(tmpDir)
  // console.debug('shell closed, reading data')
  await openEditor(tmpDir, FILE_NAME)

  const data = await readFile(tmpFile, { encoding: 'UTF-8' })

  if (GIT_REMOTE) {
    const currentBranch = (await git.branch('--show-current')).trim()
    if (await hasChanges()) {
      await git.add(FILE_NAME)
      await git.commit('-m', 'Update masked e-mails')
    }
    await git.push('--atomic', 'origin', currentBranch)
  }

  console.debug('removing working dir: "%s"', tmpDir)
  await rm(tmpDir, {
    force: true,
    recursive: true,
  })
  return parse(data, maskedEmails)
}

async function openEditor(cwd, file) {
  console.info('Waiting for the editor to close...')
  const [editor, ...editorArgs] = (process.env.EDITOR || 'vim').split(' ')
  return run(editor, [...editorArgs, file], {
    cwd,
    stdio: 'inherit',
    detached: true,
  })
}

async function openShell(cwd) {
  console.info()
  console.info('='.repeat(72))
  console.info('Interactive shell opened at "%s".', cwd)
  console.info('You can make changes by editing the file %s in your editor of choice.', FILE_NAME)
  console.info('When you are done with your changes, just close the shell.')
  console.info('='.repeat(72))
  console.info()
  return run(process.env.SHELL || '/bin/sh', [], {
    cwd,
    stdio: 'inherit',
    detached: true,
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
