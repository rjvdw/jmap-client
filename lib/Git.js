import { run } from './process.js'

export class Git {
	constructor() {
		throw new Error('cannot be constructed directly')
	}

	static create(cwd) {
		return new Proxy(
			{},
			{
				get(_target, cmd) {
					return (...args) => run('git', [cmd, ...args], { cwd })
				},
			},
		)
	}
}
