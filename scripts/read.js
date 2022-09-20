import dotenv from 'dotenv'
import { JMAP_CORE_URI, MASKED_EMAIL_URI } from '../lib/constants.js'
import { FastmailApi } from '../lib/FastmailApi.js'

dotenv.config()

const FIELDS = [
  'id',
  'email',
  'createdBy',
  'createdAt',
  'description',
  'forDomain',
  'url',
  'state',
  'lastMessageAt',
]

async function main() {
  const maskedEmails = await getMaskedEmails()

  console.log(FIELDS.join(';'))
  for (const maskedEmail of maskedEmails) {
    const line = FIELDS
      .map(f => fieldToCsv(maskedEmail[f]))
      .join(';')
    console.log(line)
  }
}

async function getMaskedEmails() {
  const fastmail = await FastmailApi.create(process.env.FASTMAIL_API_TOKEN)

  const response = await fastmail.call({
    using: [JMAP_CORE_URI, MASKED_EMAIL_URI],
    methodCalls: [
      ['MaskedEmail/get', {
        accountId: fastmail.getPrimaryAccount(MASKED_EMAIL_URI),
      }, 'a']
    ],
  })

  return response.methodResponses[0][1].list
}

function fieldToCsv(field) {
  const escaped = field
    ?.replace(/\\/g, '\\\\')
    ?.replace(/"/, '\\"')
  return `"${ escaped ?? '' }"`
}

main().catch(console.error)
