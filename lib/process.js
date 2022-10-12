import { spawn } from 'node:child_process'

export function run(...args) {
  return new Promise((resolve, reject) => {
    const process = spawn(...args)

    let stdout = ''
    if (process.stdout) {
      process.stdout.setEncoding('utf8')
      process.stdout.on('data', data => stdout += data)
    }

    let stderr = ''
    if (process.stderr) {
      process.stderr.setEncoding('utf8')
      process.stderr.on('data', data => stderr += data)
    }

    process.on('error', (error) => {
      console.error(stderr)
      reject(error)
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        console.error(stderr)
        reject(code)
      }
    })
  })
}
