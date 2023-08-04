import Axios from 'axios'

export class FastmailApi {
	#axios
	#session

	constructor(bearerToken) {
		this.#axios = Axios.create({
			headers: {
				Authorization: `Bearer ${bearerToken}`,
			},
		})
	}

	static async create(bearerToken) {
		const api = new FastmailApi(bearerToken)
		const { data } = await api.#axios.get(
			'https://api.fastmail.com/jmap/session',
		)
		api.#session = data
		return api
	}

	getPrimaryAccount(key) {
		return this.#session.primaryAccounts[key]
	}

	async call(request) {
		const { data } = await this.#axios.post(this.#session.apiUrl, request)
		return data
	}
}
