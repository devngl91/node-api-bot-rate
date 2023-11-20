const allowMethods = (...methods) => {
	return (req, res, next) => {
		if (
			!methods.map((m) => m.toUpperCase()).includes(req.method.toUpperCase())
		) {
			return res.status(401).send({
				status_msg: 'denied',
				status_msg_declaration: 'method-not-allowed',
				status_resp: `Method [ ${req.method} ] not allowed`,
			})
		}
		next()
	}
}
module.exports = { allowMethods }
