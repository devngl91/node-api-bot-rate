const express = require('express')
const app = express()
const admin = require('firebase-admin')
const credentials = require('./creds.json')
const cors = require('cors')
const { allowMethods } = require('./libs/allow_methods')
const rateLimit = require('express-rate-limit')
const { RateLimiterMemory } = require('rate-limiter-flexible')
const validator = require('validator')
require('dotenv').config()
const port = process.env.NODE_LOCAL_PORTS

/**
 *
 *
 * NOTE: API NODEJS + FIREBASE ( Firestore RealTime )
 * Criação : 15-11-2023
 * Por : Nelson Leal ( @devngl91 )
 *
 *
 * [[ Funcionalidade ]]
 * Tem a funcionalidade de ser um Middleware de RATELIMIT dos clicks feitos
 * pelos usuário, gerando a permissão, negação ou bloqueio do usuário em regras
 * de RateLimit baseado nos cliques feitos, possui uma clausula que, só irá
 * bloquear o usuário caso ele click excessivamente enquanto o click esta em
 * (modo bloqueado). O código também efetua o aviso ao usuário de quanto tempo
 * ele foi bloqueado e a hora que será desbloqueado. O próprio código faz o
 * (modo desbloqueio) do usuário quando o tempo dele expira e ele volta a clicar
 * após o tempo limite, assim o sistema entende e permite voltar aos clicks.
 *
 * [ Database ]
 * Utilizada apenas 1 Collection, e apenas 1 Insert por usuário, assim mantém a
 * aplicação do lado Backend com menos registros e menos poluição, dando espaço
 * e mantendo a identificação futura dos limites alcançados pelo o usuário
 *
 * [ Funções ]
 * addClick = adicionar o click do usuário
 * com o JSON { userId : "12345678" }
 *
 * updateclick = atualiza o click do usuário zerando 100%, será utilizado pelo
 * também pela modalidade : desbloqueio via ADM/PANEL ou outra área que precise
 * ser integrado o desbloqueio
 * com o JSON { userId : "12345678" }
 *
 * listBlocked = lista os usuários bloqueados, para serem desbloqueados manual
 * caso precise o ADM fazer isso.
 *
 * unblockClick = desbloqueia os usuarios na hora, função de ADM
 *
 */

/**
 * config de elementos do código que podem ser alterados diretamente, dessa forma
 * não precisará fazer reboot no sistema, apenas atualizar esse arquivo com a alteração
 * desejada já irá resultar na alteração.
 */
const configEnv = (config) => {
	// define o time de GMT a diminuir da hora atual, caso esteja divergente do Brasil
	let configReturn = null

	// rate limit click
	if (config == 'COLLECTION_1') {
		configReturn = 'clickRateLimitBot'
	}

	// rate limit compra
	if (config == 'COLLECTION_2') {
		configReturn = 'buyRateLimitBot'
	}

	// rate limit cancelamento
	if (config == 'COLLECTION_3') {
		configReturn = 'cancelRateLimitBot'
	}

	if (config == 'TIME_SYNC_GMT') {
		configReturn = -3
	}

	// level 1 = leve, quando zerar o time, zera os clicks tambem
	// level 2 = agressivo, quando zerar o time, não zera os clicks
	if (config == 'FLOOD_INTENSITY') {
		configReturn = 1
	}

	// tempo default do timeout de click feito - caso a aplicação não libere antes
	// defini para inicio : 15segundos
	if (config == 'FLOOD_TIMEOUT_DEFAULT') {
		configReturn = 15
	}

	// tempo default do timeout de click feito - caso a aplicação não libere antes
	// defini para inicio : 15segundos de timeout entre cada pedido
	if (config == 'FLOOD_TIMEOUT_DEFAULT_2') {
		configReturn = 10
	}

	// limite de clicks para atingir o flood + block
	if (config == 'FLOOD_0_LIMIT') {
		configReturn = 3 // aviso flood
	}
	if (config == 'FLOOD_1_LIMIT') {
		configReturn = 5 // block 1
	}
	if (config == 'FLOOD_2_LIMIT') {
		configReturn = 10 // block 2
	}
	if (config == 'FLOOD_3_LIMIT') {
		configReturn = 15 // block 3
	}
	if (config == 'FLOOD_4_LIMIT') {
		configReturn = 20 // block 4
	}
	if (config == 'FLOOD_5_LIMIT') {
		configReturn = 25 // block 5
	}

	// tempo de bloqueio para cada nivel de flood
	if (config == 'FLOOD_1_TIMEOUT') {
		configReturn = 1 // 1min
	}
	if (config == 'FLOOD_2_TIMEOUT') {
		configReturn = 3 // 3min
	}
	if (config == 'FLOOD_3_TIMEOUT') {
		configReturn = 10 // 10min
	}
	if (config == 'FLOOD_4_TIMEOUT') {
		configReturn = 15 // 15min
	}
	if (config == 'FLOOD_5_TIMEOUT') {
		configReturn = 30 // 30min
	}

	return configReturn
}

/**
 * Tratamento de CORS
 * permitindo apenas domínios autorizados a acessar a API
 * e obter o retorno de feedback
 */
var whitelist = [
	'http://localhost:3000',
	'https://rate-click-lb.numerofake.com',
	'https://rate-click-lb.mynumbervirtual.com',
	'https://core1.numerofake.com',
	'https://core1.mynumbervirtual.com',
]
var corsOptions = {
	origin: function (origin, callback) {
		// console.log('origin-cors-returned:' + origin)
		if (whitelist.indexOf(origin) !== -1) {
			callback(null, true)
		} else {
			callback(new Error('Request Not Allowed on Cors!'))
		}
	},
}
// app.use(cors(corsOptions))

/**
 * trus proxy for express : prevent 502 bad gateway
 * status : 1, permite todos
 * se especificar o proxy, vai apenas responder ao proxy, e
 * também responde array de proxy ['http://proxy1', 'http://proxy2']
 */
app.set('trust proxy', 1)

/**
 * Tratamento de bloqueio de METHOD
 * permitindo apenas metodos que serão utilizados
 */
app.use(allowMethods('get', 'post'))

/**
 *
 * middleware para envio max de dados com o express
 * limitando em 20mb o maximo de envio vindo do request
 */
app.use(express.json({ limit: '20mb' }))

/**
 *
 * ratelimit da aplicação para definir a carga vinda e evitar ataques
 * abaixo ja faz o uso de forma geral para todas as chamadas
 */
// Apply rate limiting middleware

const apiLimiter = rateLimit({
	validationsConfig: false,
	windowMs: 1 * 60 * 1000, // janela de 1/min
	max: 30000, // limit de request pela janela : 30K de clicks por minuto
	handler: function (req, res /*next*/) {
		return res.status(429).json({
			status_msg: 'blocked',
			status_msg_declaration: 'to-many-requests',
			status_resp:
				'Identificamos sua requisição como Flood. Por favor tente novamente em alguns minutos, ou você será bloqueado.',
			status_type: 'text',
		})
	},
})

app.use(apiLimiter)

/**
 * rate limit points
 * forma de controlar os clicks do usuario, e evitar que ele click muitas vezes,
 * assim ele clica 5x, mas apenas 1 click vai passar.
 * config atual : se em 5 segundos o usuário clicar 5x, significa que está
 * cometendo flood e não deve proceder com os clicks abusivos, travando antes
 * de chegar ao firebase
 */
const limiter = new RateLimiterMemory({
	points: 5, // 5 request per seconds
	duration: 5, // 5 seconds duration windows time
})
const rateLimiterClicksMiddleware = (req, res, next) => {
	limiter
		.consume(req.ip) // Track requests based on IP address
		.then(() => {
			next() // Request within the rate limit, proceed to the next middleware
		})
		.catch(() => {
			return res.status(406).json({
				status_msg: 'denied',
				status_msg_declaration: 'abuse-click',
				status_resp:
					'Por favor, clique apenas 1x e aguarde o retorno da sua requisição. Evite ser bloqueado por abuso de Flood!',
				status_type: 'text',
			})
		})
}
app.use(rateLimiterClicksMiddleware)

/**
 * funcao tokenKey middleware
 * verifica o tokenKey vindo se é válido com o .env
 */
const authMiddleware = async (req, res, next) => {
	// pega o token do header
	const token = req.header('Authorization')
	// pega o tipo de content type
	const contentType = req.header('Content-Type')
	// valida se veio token
	if (!token) {
		return res.status(400).json({
			status_msg: 'denied',
			status_msg_declaration: 'no-token-provided',
			status_resp: 'No token provided!',
			status_type: 'text',
		})
	}
	// valida se content type é valido
	if (!contentType || contentType != 'application/json') {
		return res.status(400).json({
			status_msg: 'denied',
			status_msg_declaration: 'content-type-not-allowed',
			status_resp: 'Content Type not allowed!',
			status_type: 'text',
		})
	}

	try {
		// verifica o token do .ENV com o token vindo
		const tokenKeyEnv = process.env.TOKEN_KEY_API
		if (token != tokenKeyEnv) {
			return res.status(400).json({
				status_msg: 'denied',
				status_msg_declaration: 'invalid-token',
				status_resp: 'Invalid token! ( TEST CI/CD ) New',
				status_type: 'text',
			})
		}
		next()
	} catch (err) {
		console.error(err)
		res.status(500).json({
			status_msg: 'denied',
			status_msg_declaration: 'server-error',
			status_resp: 'Server error!',
			status_type: 'text',
		})
	}
}

/**
 * trata as chamadas vindas, antes de executar, de forma a retirar qualquer
 * tentativa de DDOS, XSS, e outros ataques, e também trato a chamada que vem
 * do POST, definindo que a informação vinda, seja o que quero que seja
 * String, Num, Int, Mail, Etc
 *
 * função 1 do validator : com o ( type ) nao informado, ele vai retirar todos
 * os caracteres especiais, espaços, tudo e deixar apenas StringNumeric
 *
 * função 2 do validator : com o ( type ) ele define qual o tipo de validação
 * que deve ser feito, se é String, Numeric, Int e retorna se o tipo desejado
 * é o tipo que veio, caso não, retorna uma mensagem negando a continuação
 * da requisição
 *
 * Uma forma de previnir "injeções de informações" para bugar o sistema
 *
 */
const validatorInputs = (input, type = null) => {
	let inputCheck = false

	if (type) {
		if (type == 'isNumeric') {
			inputCheck = validator.isNumeric(input)
		} else if (type == 'isString') {
			inputCheck = validator.isString(input)
		}
	} else {
		if (input == undefined || input == null || input == '' || input <= 0) {
			inputCheck = input
		} else {
			inputCheck = input
				.toString()
				.replace(/[\s~`!@#$%^&*()_+\-={[}\]|\\:;"'<,>.?/]+/g, '')
		}
	}
	return inputCheck
}

/**
 * Inicialização firebase/firestore App
 *
 */
admin.initializeApp({
	credential: admin.credential.cert(credentials),
})

const db = admin.firestore()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const collectionClick = db.collection(configEnv('COLLECTION_1'))
const collectionBuy = db.collection(configEnv('COLLECTION_2'))
const collectionCancel = db.collection(configEnv('COLLECTION_3'))

/**
 * tratamento de data
 * default : null
 * +5 ( vai adicionar mais 5 segundos no time atual )
 * -5 ( vai retirar 5 segundos no time atual )
 */

// faz o GMT ( -3 ) ou o necessário e, converte pra mileseconds
const getLocalTime = () => {
	var d = new Date()
	var offset = configEnv('TIME_SYNC_GMT') // GMT offSet
	d.setTime(
		new Date().getTime() +
			d.getTimezoneOffset() * 60 * 1000 + // local offset
			1000 * 60 * 60 * offset
	) // target offset
	return d.getTime()
}

const dateFunc = (calculation = null, time = null) => {
	if (!time) {
		time = getLocalTime() // date now
	} else {
		// se vier date, sera o valor em segundos a acrescentar
		let dateToExpire = new Date(getLocalTime())
		let dateToExpireTime = null
		if (calculation == '+') {
			// acrescenta + minutos
			dateToExpireTime = dateToExpire.setSeconds(
				dateToExpire.getSeconds() + time
			)
		} else {
			// diminui os minutos
			dateToExpireTime = dateToExpire.setSeconds(
				dateToExpire.getSeconds() - time
			)
		}
		time = dateToExpireTime
	}
	return time
}

/**
 *
 * tratamento de data mile -> pt-BR
 * faz o tratamento de data vindo de milesegundos para o padrão pr-BR
 *
 */
const dateMileToDefault = (timestamp, type) => {
	const date = new Date(timestamp)
	let dateFormat
	let dateFormatJoin
	let dateDay
	let dateMonth
	let dateYear

	if (type == 'date') {
		// filtra o tipo de data, para mostrar a data completa + hora para o callback
		// dateFormat = date.toLocaleString('pt-BR')
		dateFormat = date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
	} else {
		// filtra o tipo de data, par amostrar apenas a hora pra o callback
		dateFormat = date.toLocaleTimeString('pt-BR')
		// força a correção da HORA correta, caso o servidor mude o padrão
		let myArr = dateFormat
		// faz um split da hora 11:11:11 em um array, para poder tratar individualmente cada
		result = myArr.split(':')

		dateDay = result[0]
		dateMonth = result[1]
		dateYear = result[2]

		dateFormatJoin = `${dateDay}:${dateMonth}:${dateYear}` // 11:11:11
		dateFormat = dateFormatJoin
	}
	return dateFormat
}

/**
 * funcao sleep
 * para dormir a aplicação por X time, para da um leve delay extra antes da execução
 */
const sleepFunc = (sleepDuration) => {
	var now = new Date().getTime()
	while (new Date().getTime() < now + sleepDuration) {
		/* Do nothing */
	}
}

/**
 * lista os usuário bloqueados
 * FIXME: pendente fazer a paginação para coletar ( X registros ) e poder
 * paginar em proximas paginas os usuários, sem sobrecarregar o FRONT-END
 * que irá consumir essa lista
 */
// app.get('/listBlocked', authMiddleware, async (req, res) => {
// 	try {
// 		const response = await collectionClick.get()
// 		let responseArr = []
// 		response.forEach((doc) => {
// 			responseArr.push({ id: doc.id, ...doc.data() })
// 		})

// 		res.status(200).send({ status_msg: 'success!', resp: responseArr })
// 	} catch (error) {
// 		res.status(403).send({ status_msg: 'fail!', resp: error })
// 	}
// })

// #########################################################################
// #################################   CLICK  ##############################
// #########################################################################

/**
 * add novo click
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 */

app.post('/addClick', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	// console.log('request:' + req.method)

	// valida o tipo do input vindo, p/ saber se ele é o esperado
	let validatorCheck = validatorInputs(userId, 'isNumeric')
	if (!validatorCheck) {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-invalid',
			status_resp:
				'Sua requisição não foi permitida. Reporte ao ADM o código : #VII409',
			status_type: 'text',
		})
	}

	// cria uma nova data de expiração ( baseado no time )
	const dateClickNow = dateFunc()
	// usa o tempo default 10/secs para uma expiração máxima
	const dateClickInitial = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT'))

	// monta os dados para insert
	const data = {
		userId: userId,
		clicks: 1,
		status: 'on',
		blockLevel: null,
		createdAt: dateClickNow,
		expiredAt: dateClickInitial,
		updatedAt: null,
	}

	// verifica se ja existe o userId no banco
	const checkUser = collectionClick.doc('' + userId + '')
	checkUser.get().then((doc) => {
		// verifica se o usuario existe - caso não, faz o cadastro
		if (!doc.exists) {
			try {
				checkUser.set(data)
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-allow',
					status_resp: dateMileToDefault(dateClickInitial, 'time'),
					status_type: 'date',
				})
			} catch (error) {
				res.status(400).send({
					status_msg: 'error',
					status_msg_declaration: 'click-allow-error-1',
					status_resp: error,
					status_type: 'text',
				})
			}
		} else {
			// o usuario ja existe

			/**
			 * verifica se status click esta ON
			 * IF YES : nao permite fazer click
			 * IF NO : permite fazer click e salva registro
			 */
			// if (doc.data().status == 'on' || doc.data().blockLevel != null) {
			if (doc.data().status == 'on') {
				/**
				 * verificar expiredAt
				 * verifica se o expiredAt esta "pendente" de ser zerado,
				 * caso SIM, pode ter sido porque a função [2] "não foi chamada"
				 * para fazer a limpeza, então aqui, força uma limpeza, para garantir
				 * a não interrupção da interação do usuário no sistema
				 */

				// pega a data salva atual de expiração
				const dateClickExpiration = doc.data().expiredAt

				// pega total clicks atuais do usuario
				const clicksSum = doc.data().clicks

				// verifica se a dataAtual é > que a dataExpiração - e faz um zerar status = off ( force)
				if (dateClickNow > dateClickExpiration) {
					try {
						const blockLevelUser = doc.data().blockLevel
						let newClicks = 0
						let newBlockLevelUser = 0

						/**
						 * se o blockLevel já estiver no 5, e o tempo expirou, apenas
						 * zera os clicks p/ resetar e zera o blockLevel tambem
						 */
						if (blockLevelUser == 5) {
							newClicks = newClicks
							newBlockLevelUser = newBlockLevelUser
						} else {
							/**
							 * se for blockLevel abaixo de 5, roda o FLOOD_INTENSITY
							 * para determinar se zera os clicks + blockLevel ou
							 * se mantem os clicks e zera o BlockLevel
							 */
							// FLOOD_INTENSITY = level 1 ( zera os clicks + blockLevel )
							if (configEnv('FLOOD_INTENSITY') == 1) {
								newClicks = newClicks
								newBlockLevelUser = newBlockLevelUser
							} else {
								// FLOOD_INTENSITY = level 2 ( zera o blocklevel + não zera os clicks )
								newClicks = clicksSum
								newBlockLevelUser = newBlockLevelUser
							}
						}

						const data = {
							status: 'off',
							blockLevel: newBlockLevelUser,
							clicks: newClicks,
							updatedAt: dateClickNow,
						}

						// aqui faz a atualização com o status off + data do updated
						const updateUserById = collectionClick
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'click-allow',
							status_resp: dateMileToDefault(dateClickExpiration, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'click-allow-error-2',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else {
					// verifica quantos clicks ja foram dados p/ alertar ao usuario sobre o Flood
					// cada flood tera um clique limit + tempo em ( min )
					const flood_0_limit = configEnv('FLOOD_0_LIMIT')
					const flood_1_limit = configEnv('FLOOD_1_LIMIT')
					const flood_2_limit = configEnv('FLOOD_2_LIMIT')
					const flood_3_limit = configEnv('FLOOD_3_LIMIT')
					const flood_4_limit = configEnv('FLOOD_4_LIMIT')
					const flood_5_limit = configEnv('FLOOD_5_LIMIT')

					// valida quantos floods o usuário ja fez pra notificar + aplicar penalidade
					if (clicksSum >= flood_0_limit && clicksSum < flood_1_limit) {
						try {
							// pega o total de clicks atuais e add + 1 para ser salvo no banco
							const data = {
								clicks: clicksSum + 1,
								blockLevel: 0,
							}
							// aqui faz a atualização o novo total de clicks feitos
							const updateUserById = collectionClick
								.doc('' + userId + '')
								.update(data)

							res.status(401).send({
								status_msg: 'flood',
								status_msg_declaration: 'click-flood-warning',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-warning-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else if (clicksSum >= flood_1_limit && clicksSum < flood_2_limit) {
						try {
							/**
							 * aqui valida a dataNow + dataExpired p/ garantir que já esta fora
							 * do bloqueio, e garantir que não seja adicionado caso a data NOW
							 * seja maior que data EXPIRED.
							 */
							if (dateClickNow < dateClickExpiration) {
								// pega o total de clicks atuais e add + 1 para ser salvo no banco
								const data = {
									clicks: clicksSum + 1,
									blockLevel: 1,
									expiredAt: dateFunc('+', 60), // 1min
								}
								// aqui faz a atualização o novo total de clicks feitos
								const updateUserById = collectionClick
									.doc('' + userId + '')
									.update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-1',
								status_resp:
									configEnv('FLOOD_1_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-1-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else if (clicksSum >= flood_2_limit && clicksSum < flood_3_limit) {
						try {
							/**
							 * aqui valida a dataNow + dataExpired p/ garantir que já esta fora
							 * do bloqueio, e garantir que não seja adicionado caso a data NOW
							 * seja maior que data EXPIRED.
							 */
							if (dateClickNow < dateClickExpiration) {
								// pega o total de clicks atuais e add + 1 para ser salvo no banco
								const data = {
									clicks: clicksSum + 1,
									blockLevel: 2,
									expiredAt: dateFunc('+', 180), // 3min
								}
								// aqui faz a atualização o novo total de clicks feitos
								const updateUserById = collectionClick
									.doc('' + userId + '')
									.update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-2',
								status_resp:
									configEnv('FLOOD_2_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-2-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else if (clicksSum >= flood_3_limit && clicksSum < flood_4_limit) {
						try {
							/**
							 * aqui valida a dataNow + dataExpired p/ garantir que já esta fora
							 * do bloqueio, e garantir que não seja adicionado caso a data NOW
							 * seja maior que data EXPIRED.
							 */
							if (dateClickNow < dateClickExpiration) {
								// pega o total de clicks atuais e add + 1 para ser salvo no banco
								const data = {
									clicks: clicksSum + 1,
									blockLevel: 3,
									expiredAt: dateFunc('+', 600), // 10min
								}
								// aqui faz a atualização o novo total de clicks feitos
								const updateUserById = collectionClick
									.doc('' + userId + '')
									.update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-3',
								status_resp:
									configEnv('FLOOD_3_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-3-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else if (clicksSum >= flood_4_limit && clicksSum < flood_5_limit) {
						try {
							/**
							 * aqui valida a dataNow + dataExpired p/ garantir que já esta fora
							 * do bloqueio, e garantir que não seja adicionado caso a data NOW
							 * seja maior que data EXPIRED.
							 */
							if (dateClickNow < dateClickExpiration) {
								// pega o total de clicks atuais e add + 1 para ser salvo no banco
								const data = {
									clicks: clicksSum + 1,
									blockLevel: 4,
									expiredAt: dateFunc('+', 900), // 15min
								}
								// aqui faz a atualização o novo total de clicks feitos
								const updateUserById = collectionClick
									.doc('' + userId + '')
									.update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-4',
								status_resp:
									configEnv('FLOOD_4_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-4-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else if (clicksSum >= flood_5_limit) {
						try {
							/**
							 * aqui valida a dataNow + dataExpired p/ garantir que já esta fora
							 * do bloqueio, e garantir que não seja adicionado caso a data NOW
							 * seja maior que data EXPIRED.
							 */
							if (dateClickNow < dateClickExpiration) {
								/**
								 * parar de incluir clicks + updates apos o usuario entrar no flood-5
								 * isso vai garantir que se ele ja esta bloqueado, não faça mais nenhum insert
								 * para frente, sendo que não tem outro verificador de nível superior,
								 * então aqui, só alerta pra ele a mensagem até o horario expirar e voltar a
								 * fucionar novamente o click para o usuario
								 */
								if (doc.data().blockLevel < 5) {
									// pega o total de clicks atuais e add + 1 para ser salvo no banco
									const data = {
										clicks: clicksSum + 1,
										blockLevel: 5,
										expiredAt: dateFunc('+', 1800), // 30min
									}
									// aqui faz a atualização o novo total de clicks feitos
									const updateUserById = collectionClick
										.doc('' + userId + '')
										.update(data)
								}
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-5',
								status_resp:
									configEnv('FLOOD_5_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-5-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else {
						// aqui faz o bloqueio de request apenas para alertar que nao pode clicar novamente
						try {
							// pega o total de clicks atuais e add + 1 para ser salvo no banco
							const data = {
								clicks: clicksSum + 1,
							}
							// aqui faz a atualização o novo total de clicks feitos
							const updateUserById = collectionClick
								.doc('' + userId + '')
								.update(data)

							res.status(401).send({
								status_msg: 'denied',
								status_msg_declaration: 'click-denied',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-denied-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					}
				}
			} else {
				// status atual : off
				// faz o status : on ( novamente ), pois aqui o usuário voltou a clicar
				// e considera um block pois o usuário já clicou e o expiredAt ainda pendente
				try {
					const data = {
						status: 'on',
						expiredAt: dateClickInitial,
					}

					// aqui faz a atualização com o status on + data do expiredAt p/ expiração
					const updateUserById = collectionClick
						.doc('' + userId + '')
						.update(data)

					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'click-allow',
						status_resp: dateMileToDefault(dateClickInitial, 'time'),
						status_type: 'date',
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-in-execution-error',
						status_resp: error,
						status_type: 'text',
					})
				}
			}
		}
	})
})

/**
 * atualiza o status para = off quando o comando da request for finalizada do
 * lado Bot Python. porem, não pode desbloquear um usuário que já estiver bloqueado
 * apenas mostrar para ele que esta bloqueado! isso evita que libere um usuario
 * que forçou ser bloqueado. ( boa sacada que o Weslen viu e não vi )
 */
app.post(
	'/updateClick',
	authMiddleware,

	async (req, res) => {
		// pegar o userId vindo do POST ( pelo CORE )
		// pega e valida userId tirando tudo que tiver de special character
		const userId = validatorInputs(req.body.userId)

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII409',
				status_type: 'text',
			})
		}

		// define a data Expired como a data de agora
		const dateClickNow = dateFunc()

		const checkUser = collectionClick.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se o usuario existe - caso não, faz o cadastro
			if (doc.exists) {
				try {
					// sleep para da um "extra delay" na liberação do usuário
					// sleepFunc(1000)

					// verifica se o usuário vindo está bloqueado, se sim, não libera
					let blockLevelActual = doc.data().blockLevel

					if (blockLevelActual > 0 && blockLevelActual != null) {
						// pega o nivel de bloqueio para retornar ao usuário o tempo
						if (blockLevelActual == 1) {
							blockLevelActual = configEnv('FLOOD_1_TIMEOUT')
						} else if (blockLevelActual == 2) {
							blockLevelActual = configEnv('FLOOD_2_TIMEOUT')
						} else if (blockLevelActual == 3) {
							blockLevelActual = configEnv('FLOOD_3_TIMEOUT')
						} else if (blockLevelActual == 4) {
							blockLevelActual = configEnv('FLOOD_4_TIMEOUT')
						} else if (blockLevelActual == 5) {
							blockLevelActual = configEnv('FLOOD_5_TIMEOUT')
						}

						// aqui retorna para o usuário que ele está bloqueado + o tempo
						res.status(401).send({
							status_msg: 'blocked',
							status_msg_declaration: 'click-flood-block-updated',
							status_resp:
								blockLevelActual +
								'/' +
								dateMileToDefault(doc.data().expiredAt, 'time'),
							status_type: 'date',
						})
					} else {
						// aqui permiti passar e zerar pois o usuário não está bloqueado
						const data = {
							clicks: 0,
							status: 'off',
							blockLevel: 0,
							expiredAt: dateClickNow,
							updatedAt: dateClickNow,
						}
						// aqui faz a atualização zerando o score do usuario
						const updateUserById = collectionClick
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'click-updated',
							status_resp: dateMileToDefault(dateClickNow, 'time'),
							status_type: 'date',
						})
					}
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-updated-error',
						status_resp: error,
						status_type: 'text',
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-updated',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
					status_type: 'date',
				})
			}
		})
	}
)

/**
 * função para ADM, que ira liberar o usuario de forma manual se precisar,
 * pode ser usado via Bot ou via Adm-Site
 */
app.post(
	'/unblockClick',
	authMiddleware,

	async (req, res) => {
		// pegar o userId vindo do POST ( pelo CORE )
		// pega e valida userId tirando tudo que tiver de special character
		const userId = validatorInputs(req.body.userId)

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII409',
				status_type: 'text',
			})
		}

		// define a data Expired como a data de agora
		const dateClickNow = dateFunc()

		const checkUser = collectionClick.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se o usuario existe - caso não, faz o cadastro
			if (doc.exists) {
				try {
					// sleep para da um "extra delay" na liberação do usuário
					// sleepFunc(1000)

					const data = {
						clicks: 0,
						status: 'off',
						blockLevel: 0,
						expiredAt: dateClickNow,
						updatedAt: dateClickNow,
					}
					// aqui faz a atualização zerando o score do usuario
					const updateUserById = collectionClick
						.doc('' + userId + '')
						.update(data)

					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'click-updated',
						status_resp: dateMileToDefault(dateClickNow, 'time'),
						status_type: 'date',
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-updated-error',
						status_resp: error,
						status_type: 'text',
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-updated',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
					status_type: 'date',
				})
			}
		})
	}
)

// #########################################################################
// ##################################   BUY  ###############################
// #########################################################################

/**
 * comprar novo serviço
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 */

app.post('/rateBuy1', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	if (userId == undefined || userId <= 0 || !userId || userId == '') {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId',
			status_type: 'text',
		})
	} else {
		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII410',
				status_type: 'text',
			})
		}

		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()
		// usa o tempo default 30/secs para uma expiração máxima
		const dateClickInitial = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT_2'))

		// verifica se ja existe o userId no banco
		const checkUser = collectionBuy.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se o usuario existe - caso não, faz o cadastro
			if (!doc.exists) {
				try {
					// monta os dados para insert
					const data = {
						userId: userId,
						status: 1,
						numberCode: null,
						createdAt: dateClickNow,
						expiredAt: dateClickInitial,
						updatedAt: null,
					}

					// faz o set 1x
					checkUser.set(data)

					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'buy-allow',
						status_resp: dateMileToDefault(dateClickInitial, 'time'),
						status_type: 'date',
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'buy-allow-error-1',
						status_resp: error,
						status_type: 'text',
					})
				}
			} else {
				// o usuario ja existe

				/**
				 * verifica se status > 0
				 * IF YES : significa que já existe 1 compra em endamento e não permite novas
				 * IF NO : significa que não existe compra em andamento e permite
				 */
				// if (doc.data().status == 'on' || doc.data().blockLevel != null) {
				if (doc.data().status > 0) {
					/**
					 * verificar expiredAt
					 * verifica se o expiredAt esta "pendente" de ser zerado,
					 * caso SIM, pode ter sido porque a função [2] "não foi chamada"
					 * para fazer a limpeza, então aqui, força uma limpeza, para garantir
					 * a não interrupção da interação do usuário no sistema
					 */

					// pega a data salva atual de expiração
					const dateClickExpiration = doc.data().expiredAt

					// verifica se a dataAtual é > que a dataExpiração e status é igual = 2
					// dai faz o status ser zero pois ele ja finalizou o time e loop dele.
					if (dateClickNow > dateClickExpiration && doc.data().status == 2) {
						try {
							const data = {
								status: 0,
								numberCode: null,
								updatedAt: dateClickNow,
								expiredAt: dateClickNow,
							}

							/**
							* 
							aqui faz a atualização com o status 1 + data do updated + data expired nova
							mantendo status 1 : requisições futuras não irão passar de ( 1 )
							assim, quando o sistema "liberar" e avisar que está liberado p/ o usuário, 
							ele já estará enviando uma nova requisição, pois aqui não é o CLICK,
							e sim, essa rota apenas irá processar requisições de compra.
						  */

							const updateUserById = collectionBuy
								.doc('' + userId + '')
								.update(data)

							res.status(200).send({
								status_msg: 'allow',
								status_msg_declaration: 'buy-allow',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'buy-allow-error-2',
								status_resp: error,
								status_type: 'text',
							})
						}
					} else {
						// aqui a dataAtual é < que a dataExpiração - então não permite novas compras

						try {
							res.status(401).send({
								status_msg: 'denied',
								status_msg_declaration: 'buy-denied-pending-process',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'buy-allow-error-3',
								status_resp: error,
								status_type: 'text',
							})
						}
					}
				} else {
					// status atual : off
					// faz o status : on ( novamente ), pois aqui o usuário voltou a clicar
					// e considera um block pois o usuário já clicou e o expiredAt ainda pendente
					try {
						const data = {
							status: 1,
							numberCode: null,
							expiredAt: dateClickInitial,
						}

						// aqui faz a atualização com o status on + data do expiredAt p/ expiração
						const updateUserById = collectionBuy
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'buy-allow',
							status_resp: dateMileToDefault(dateClickInitial, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'buy-in-execution-error',
							status_resp: error,
							status_type: 'text',
						})
					}
				}
			}
		})
	}
})

/**
 * recebe o numero do pedido + valida retorno p/ proxima fase do sistema
 * vira apenas
 * {
 *  "userId" : "idDoUser000",
 *  "numberCode" : "12039784986"
 * }
 */

app.post('/rateBuy2', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)
	const numberCode = validatorInputs(req.body.numberCode)

	if (
		userId == undefined ||
		userId <= 0 ||
		!userId ||
		userId == '' ||
		numberCode == undefined ||
		numberCode <= 0 ||
		!numberCode ||
		numberCode == ''
	) {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId + numberCode',
			status_type: 'text',
		})
	} else {
		// console.log('1ax')

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII412',
				status_type: 'text',
			})
		}

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck2 = validatorInputs(numberCode, 'isNumeric')
		if (!validatorCheck2) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII413',
				status_type: 'text',
			})
		}

		/**
		 * validar se o status é == 1 se for, nessa fase ele deve permitir
		 * caso não seja, e status seja == 0, ele nao permite o usuário continuar,
		 * e gera um novo block e expiração, p/ forçar o usuário no futuro "desbloquear"
		 * e notifica o usuário
		 */
		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()
		// usa o tempo default 10/secs para uma expiração máxima
		const dateClickFinal = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT_2'))

		const checkUser = collectionBuy.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se existe registro, pois assim evita error no codigo e restart
			if (doc.exists) {
				// verificar status == 1 ( permitir continuar )
				if (doc.data().status == 1) {
					try {
						// atualiza
						/**
						 * 
							monta os dados para update
							add o numerCode, e nova data de expiração nessa fase ( atualizando )
							só add nova data de expiração, para manter "mais um timer" desse processo
							mas quem vai liberar de fato o sistema será o updateBuyRate
						*/
						const data = {
							status: 2,
							numberCode: numberCode,
							// expiredAt: dateClickFinal,
							updatedAt: dateClickNow,
						}

						const updateUserById = collectionBuy
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'buy-allow',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'buy-allow-error-1',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else if (doc.data().status <= 0) {
					// significa que é status == 0  ( bloqueia + notifica )

					const data = {
						status: 1,
						numberCode: null,
						expiredAt: dateClickFinal,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionBuy
							.doc('' + userId + '')
							.update(data)

						res.status(401).send({
							status_msg: 'denied',
							status_msg_declaration: 'buy-denied-pending-process',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'buy-allow-error-4',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else if (doc.data().status == 2) {
					// significa qu é status == 2 ( bloqueia e notifica )

					const data = {
						expiredAt: dateClickFinal,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionBuy
							.doc('' + userId + '')
							.update(data)

						res.status(401).send({
							status_msg: 'denied',
							status_msg_declaration: 'buy-denied-pending-process',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'buy-allow-error-5',
							status_resp: error,
							status_type: 'text',
						})
					}
				}
			}
		})
	}
})

/**
 * faz o upate do usuario, liberando ele para o retorno do zero ( compra )
 * porem pega o status == 2, pra garantir de não pegar nenhum update onde
 * o status é == 1
 * {
 *  "userId" : "idDoUser000",
 * }
 * 26-11-23
 * Desativando updateRate p/ testar de forma independente somente via o rateBuy1
 *
 */

app.post('/updateRateBuy_OFF', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	if (userId == undefined || userId <= 0 || !userId || userId == '') {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId',
			status_type: 'text',
		})
	} else {
		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII414',
				status_type: 'text',
			})
		}

		const checkUser = collectionBuy.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se existe registro, pois assim evita error no codigo e restart
			if (doc.exists) {
				// sleep de test para ter 3 segundos apos o upate click vir
				// sleep(3000)

				/**
		 *
		verificar status == 2 ( pois aqui, ele apenas pega se status == 2 )
		garantindo que apenas vai liberar via codigo se já esta concluido a fase
		1 previnindo do sistema da algum BUG/ERROR e liberar antes de concluir
		*/
				if (doc.data().status == 2) {
					/**
			 *  
			monta os dados para update
			add o numerCode, e nova data de expiração nessa fase ( atualizando )
			só add nova data de expiração, para manter "mais um timer" desse processo
			mas quem vai liberar de fato o sistema será o updateBuyRate
			*/
					const data = {
						status: 0,
						numberCode: null,
						expiredAt: dateClickNow,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionBuy
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'buy-allow',
							status_resp: dateMileToDefault(dateClickNow, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'buy-allow-error-1',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else {
					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'buy-allow',
						status_resp: dateMileToDefault(dateClickNow, 'time'),
						status_type: 'date',
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'buy-allow',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
					status_type: 'date',
				})
			}
		})
	}
})

// #########################################################################
// ################################  CANCEL   ##############################
// #########################################################################

/**
 * comprar novo serviço
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 */

app.post('/rateCancel1_OFF', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	if (userId == undefined || userId <= 0 || !userId || userId == '') {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId',
			status_type: 'text',
		})
	} else {
		// console.log('request:' + req.method)

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII415',
				status_type: 'text',
			})
		}

		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()
		// usa o tempo default 10/secs para uma expiração máxima
		const dateClickInitial = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT_2'))

		// monta os dados para insert
		const data = {
			userId: userId,
			status: 1,
			createdAt: dateClickNow,
			expiredAt: dateClickInitial,
			updatedAt: null,
		}

		// verifica se ja existe o userId no banco
		const checkUser = collectionCancel.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se existe registro, pois assim evita error no codigo e restart
			if (doc.exists) {
				// verifica se o usuario existe - caso não, faz o cadastro
				if (!doc.exists) {
					try {
						checkUser.set(data)
						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'cancel-allow',
							status_resp: dateMileToDefault(dateClickInitial, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'cancel-allow-error-1',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else {
					// o usuario ja existe

					/**
					 * verifica se status > 0
					 * IF YES : significa que já existe 1 compra em endamento e não permite novas
					 * IF NO : significa que não existe compra em andamento e permite
					 */
					// if (doc.data().status == 'on' || doc.data().blockLevel != null) {
					if (doc.data().status > 0) {
						/**
						 * verificar expiredAt
						 * verifica se o expiredAt esta "pendente" de ser zerado,
						 * caso SIM, pode ter sido porque a função [2] "não foi chamada"
						 * para fazer a limpeza, então aqui, força uma limpeza, para garantir
						 * a não interrupção da interação do usuário no sistema
						 */

						// pega a data salva atual de expiração
						const dateClickExpiration = doc.data().expiredAt

						// verifica se a dataAtual é > que a dataExpiração - e faz um zerar status = 0 ( force)
						if (dateClickNow > dateClickExpiration) {
							try {
								const data = {
									status: 1,
									updatedAt: dateClickNow,
									expiredAt: dateClickInitial,
								}

								/**
							* 
							aqui faz a atualização com o status 1 + data do updated + data expired nova
							mantendo status 1 : requisições futuras não irão passar de ( 1 )
							assim, quando o sistema "liberar" e avisar que está liberado p/ o usuário, 
							ele já estará enviando uma nova requisição, pois aqui não é o CLICK,
							e sim, essa rota apenas irá processar requisições de compra.

						  */
								const updateUserById = collectionCancel
									.doc('' + userId + '')
									.update(data)

								res.status(200).send({
									status_msg: 'allow',
									status_msg_declaration: 'cancel-allow',
									status_resp: dateMileToDefault(dateClickExpiration, 'time'),
									status_type: 'date',
								})
							} catch (error) {
								res.status(400).send({
									status_msg: 'error',
									status_msg_declaration: 'cancel-allow-error-2',
									status_resp: error,
									status_type: 'text',
								})
							}
						} else {
							// aqui a dataAtual é < que a dataExpiração - então não permite novas compras

							try {
								res.status(401).send({
									status_msg: 'denied',
									status_msg_declaration: 'cancel-denied-pending-process',
									status_resp: dateMileToDefault(dateClickExpiration, 'time'),
									status_type: 'date',
								})
							} catch (error) {
								res.status(400).send({
									status_msg: 'error',
									status_msg_declaration: 'cancel-allow-error-3',
									status_resp: error,
									status_type: 'text',
								})
							}
						}
					} else {
						// status atual : off
						// faz o status : on ( novamente ), pois aqui o usuário voltou a clicar
						// e considera um block pois o usuário já clicou e o expiredAt ainda pendente
						try {
							const data = {
								status: 1,
								numberCode: null,
								expiredAt: dateClickInitial,
							}

							// aqui faz a atualização com o status on + data do expiredAt p/ expiração
							const updateUserById = collectionCancel
								.doc('' + userId + '')
								.update(data)

							res.status(200).send({
								status_msg: 'allow',
								status_msg_declaration: 'cancel-allow',
								status_resp: dateMileToDefault(dateClickInitial, 'time'),
								status_type: 'date',
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'cancel-in-execution-error',
								status_resp: error,
								status_type: 'text',
							})
						}
					}
				}
			}
		})
	}
})

/**
 * recebe o numero do pedido + valida retorno p/ proxima fase do sistema
 * vira apenas
 * {
 *  "userId" : "idDoUser000",
 *  "numberCode" : "12039784986"
 * }
 */

app.post('/rateCancel2_OFF', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	if (userId == undefined || userId <= 0 || !userId || userId == '') {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId',
			status_type: 'text',
		})
	} else {
		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII416',
				status_type: 'text',
			})
		}

		/**
		 * validar se o status é == 1 se for, nessa fase ele deve permitir
		 * caso não seja, e status seja == 0, ele nao permite o usuário continuar,
		 * e gera um novo block e expiração, p/ forçar o usuário no futuro "desbloquear"
		 * e notifica o usuário
		 */

		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()
		// usa o tempo default 10/secs para uma expiração máxima
		const dateClickFinal = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT_2'))

		const checkUser = collectionCancel.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se existe registro, pois assim evita error no codigo e restart
			if (doc.exists) {
				// verificar status == 1 ( permitir continuar )
				if (doc.data().status == 1) {
					/**
	 * 
		monta os dados para update
		nova data de expiração nessa fase ( atualizando )
		só add nova data de expiração, para manter "mais um timer" desse processo
		mas quem vai liberar de fato o sistema será o updateRateCancel
	 */
					const data = {
						status: 2,
						expiredAt: dateClickFinal,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionCancel
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'cancel-allow',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'cancel-allow-error-1',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else if (doc.data().status <= 0) {
					// significa que é status == 0  ( bloqueia + notifica )

					const data = {
						status: 1,
						expiredAt: dateClickFinal,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionCancel
							.doc('' + userId + '')
							.update(data)

						res.status(401).send({
							status_msg: 'denied',
							status_msg_declaration: 'cancel-denied-pending-process',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'cancel-allow-error-4',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else if (doc.data().status == 2) {
					// significa qu é status == 2 ( bloqueia e notifica )

					const data = {
						expiredAt: dateClickFinal,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionCancel
							.doc('' + userId + '')
							.update(data)

						res.status(401).send({
							status_msg: 'denied',
							status_msg_declaration: 'cancel-denied-pending-process',
							status_resp: dateMileToDefault(dateClickFinal, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'cancel-allow-error-5',
							status_resp: error,
							status_type: 'text',
						})
					}
				}
			}
		})
	}
})

/**
 * faz o upate do usuario, liberando ele para o retorno do zero ( cancelamento )
 * porem pega o status == 2, pra garantir de não pegar nenhum update onde
 * o status é == 1
 * {
 *  "userId" : "idDoUser000",
 * }
 */

app.post('/updateRateCancel_OFF', authMiddleware, async (req, res) => {
	// pega e valida userId tirando tudo que tiver de special character
	const userId = validatorInputs(req.body.userId)

	if (userId == undefined || userId <= 0 || !userId || userId == '') {
		return res.status(409).send({
			status_msg: 'denied',
			status_msg_declaration: 'validator-input-not-fill',
			status_resp: 'Prencha o userId',
			status_type: 'text',
		})
	} else {
		// cria uma nova data de expiração ( baseado no time )
		const dateClickNow = dateFunc()

		// valida o tipo do input vindo, p/ saber se ele é o esperado
		let validatorCheck = validatorInputs(userId, 'isNumeric')
		if (!validatorCheck) {
			return res.status(409).send({
				status_msg: 'denied',
				status_msg_declaration: 'validator-input-invalid',
				status_resp:
					'Sua requisição não foi permitida. Reporte ao ADM o código : #VII414',
				status_type: 'text',
			})
		}

		const checkUser = collectionCancel.doc('' + userId + '')
		checkUser.get().then((doc) => {
			// verifica se existe registro, pois assim evita error no codigo e restart
			if (doc.exists) {
				/**
		 *
		verificar status == 2 ( pois aqui, ele apenas pega se status == 2 )
		garantindo que apenas vai liberar via codigo se já esta concluido a fase
		1 previnindo do sistema da algum BUG/ERROR e liberar antes de concluir
		*/
				if (doc.data().status == 2) {
					/**
			 *  
			monta os dados para update
			add o numerCode, e nova data de expiração nessa fase ( atualizando )
			só add nova data de expiração, para manter "mais um timer" desse processo
			mas quem vai liberar de fato o sistema será o updateBuyRate
			*/
					const data = {
						status: 0,
						expiredAt: dateClickNow,
						updatedAt: dateClickNow,
					}

					try {
						// atualiza
						const updateUserById = collectionCancel
							.doc('' + userId + '')
							.update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'cancel-allow',
							status_resp: dateMileToDefault(dateClickNow, 'time'),
							status_type: 'date',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'cancel-allow-error-1',
							status_resp: error,
							status_type: 'text',
						})
					}
				} else {
					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'cancel-allow',
						status_resp: dateMileToDefault(dateClickNow, 'time'),
						status_type: 'date',
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'cancel-allow',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
					status_type: 'date',
				})
			}
		})
	}
})

/**
 * health check
 * area usada para verificar a saude da API, retornando...
 * 200 = success
 * 503 = service unavailable
 */
app.get('/healthCheckApi', async (req, res) => {
	try {
		res.status(200).send({
			status_msg: 'health',
			status_resp: dateMileToDefault(dateFunc(), 'date') + ' UTC',
			status_type: 'date',
		})
	} catch (error) {
		res.status(503).send({
			status_msg: 'error',
			status_resp: error,
			status_type: 'text',
		})
	}
})

app.listen(port, () => console.log(`API is running on Port :: ${port}`))
