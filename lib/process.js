import { spawn } from 'node:child_process'

export function run(...args) {
  return new Promise((resolve, reject) => {
    const process = spawn(...args)
    process.on('error', (error) => {
      reject(error)
    })
    process.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(code)
      }
    })
  })
}
