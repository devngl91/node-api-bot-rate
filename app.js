const express = require('express')
const app = express()
const admin = require('firebase-admin')
const credentials = require('./creds.json')
const cors = require('cors')
const allowMethods = require('allow-methods')
const rateLimit = require('express-rate-limit')
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
 * [ Funcionalidade ]
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
 */

/**
 * Tratamento de bloqueio de METHOD
 * permitindo apenas metodos que serão utilizados
 */
app.use(allowMethods(['get', 'post']))

/**
 * middleware para envio max de dados com o express
 * limitando em 100mb o maximo de envio vindo do request
 */
app.use(express.json({ limit: '100mb' }))

/**
 * config de elementos do código que podem ser alterados diretamente, dessa forma
 * não precisará fazer reboot no sistema, apenas atualizar esse arquivo com a alteração
 * desejada já irá resultar na alteração.
 */
const configEnv = (config) => {
	// define o time de GMT a diminuir da hora atual, caso esteja divergente do Brasil
	let configReturn = null

	if (config == 'TIME_SYNC_GMT') {
		configReturn = 3
	}

	// level 1 = leve, quando zerar o time, zera os clicks tambem
	// level 2 = agressivo, quando zerar o time, não zera os clicks
	if (config == 'FLOOD_INTENSITY') {
		configReturn = 1
	}

	// tempo default do timeout de click feito - caso a aplicação não libere antes
	// defini para inicio : 10segundos
	if (config == 'FLOOD_TIMEOUT_DEFAULT') {
		configReturn = 10
	}

	// limite de clicks para atingir o flood + block
	if (config == 'FLOOD_0_LIMIT') {
		configReturn = 3 // aviso flood
	}
	if (config == 'FLOOD_1_LIMIT') {
		configReturn = 7 // block 1
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
 * ratelimit da aplicação para definir a carga vinda e evitar ataques
 * abaixo ja faz o uso de forma geral para todas as chamadas
 */
// Apply rate limiting middleware
const apiLimiter = rateLimit({
	windowMs: 2 * 60 * 1000, // janela de 2/min
	max: 500000, // limit de request pela janela : 500K
	handler: function (req, res /*next*/) {
		return res.status(429).json({
			status_msg: 'blocked',
			status_msg_declaration: 'to-many-requests',
			status_resp:
				'Identificamos muitas requisições, tente novamente daqui a alguns minutos!',
		})
	},
})
app.use(apiLimiter)

/**
 * Tratamento de CORS
 * permitindo apenas domínios autorizados a acessar a API
 * e obter o retorno de feedback
 */
var whitelist = ['http://localhost', 'http://example2.com']
var corsOptions = {
	origin: function (origin, callback) {
		if (whitelist.indexOf(origin) !== -1) {
			callback(null, true)
		} else {
			// callback(new Error('Request Not Allowed!'))
			callback(null, false)
		}
	},
}

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
		return res.status(401).json({
			status_msg: 'denied',
			status_msg_declaration: 'no-token-provided',
			status_resp: 'No token provided!',
		})
	}
	// valida se content type é valido
	if (!contentType || contentType != 'application/json') {
		return res.status(401).json({
			status_msg: 'denied',
			status_msg_declaration: 'content-type-not-allowed',
			status_resp: 'Content Type not allowed!',
		})
	}

	try {
		// verifica o token do .ENV com o token vindo
		const tokenKeyEnv = process.env.TOKEN_KEY_API
		if (token != tokenKeyEnv) {
			return res.status(401).json({
				status_msg: 'denied',
				status_msg_declaration: 'invalid-token',
				status_resp: 'Invalid token!',
			})
		}
		next()
	} catch (err) {
		console.error(err)
		res.status(500).json({
			status_msg: 'denied',
			status_msg_declaration: 'server-error',
			status_resp: 'Server error!',
		})
	}
}

/**
 * Inicialização firebase/firestore App
 */
admin.initializeApp({
	credential: admin.credential.cert(credentials),
})

const db = admin.firestore()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const collectionClick = db.collection(process.env.COLLECTION_CLICK)

/**
 * tratamento de data
 * default : null
 * +5 ( vai adicionar mais 5 segundos no time atual )
 * -5 ( vai retirar 5 segundos no time atual )
 */
const dateFunc = (calculation = null, time = null) => {
	// se não vier date, sera a data atual
	if (!time) {
		time = Date.now()
	} else {
		// se vier date, sera o valor em segundos a acrescentar
		let dateToExpire = new Date()
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
 * tratamento de data mile -> pt-BR
 * faz o tratamento de data vindo de milesegundos para o padrão pr-BR
 *
 */
const dateMileToDefault = (timestamp, type) => {
	const date = new Date(timestamp)
	let dateFormat

	if (type == 'date') {
		// filtra o tipo de data, para mostrar a data completa + hora para o callback
		dateFormat = date.toLocaleString('pt-BR')
	} else {
		// filtra o tipo de data, par amostrar apenas a hora pra o callback
		dateFormat = date.toLocaleTimeString('pt-BR')
		// força a correção da HORA correta, caso o servidor mude o padrão
		let myArr = dateFormat
		// faz um split da hora 11:11:11 em um array, para poder tratar individualmente cada
		result = myArr.split(':')
		// faz o split e subtração da hora p/ corrigir ( em 3 hrs abaixo )
		//FIXME: chamada .env não funciona ( TIME_SYNC_GMT) on tem [-3+]
		// dateFormat =
		// 	result[0] - configEnv('TIME_SYNC_GMT') + ':' + result[1] + ':' + result[2]
		dateFormat = result[0] + ':' + result[1] + ':' + result[2]
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
app.get('/listBlocked', authMiddleware, cors(corsOptions), async (req, res) => {
	try {
		const response = await collectionClick.get()
		let responseArr = []
		response.forEach((doc) => {
			responseArr.push({ id: doc.id, ...doc.data() })
		})

		res.status(200).send({ status_msg: 'success!', resp: responseArr })
	} catch (error) {
		res.status(403).send({ status_msg: 'fail!', resp: error })
	}
})

/**
 * add novo click
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 */

app.post('/addClick', authMiddleware, cors(corsOptions), async (req, res) => {
	// pegar o userId
	const userId = req.body.userId

	// cria uma nova data de expiração ( baseado no time )
	const dateClickNow = dateFunc()
	// usa o tempo default 10/secs para uma expiração máxima
	const dateClickInitial = dateFunc('+', configEnv('FLOOD_TIMEOUT_DEFAULT'))

	// monta os dados para insert
	const dataJSON = {
		userId: userId,
		clicks: 1,
		status: 'on',
		blockLevel: null,
		createdAt: dateClickNow,
		expiredAt: dateClickInitial,
		updatedAt: null,
	}

	// verifica se ja existe o userId no banco
	const checkUser = collectionClick.doc(userId)
	checkUser.get().then((doc) => {
		// verifica se o usuario existe - caso não, faz o cadastro
		if (!doc.exists) {
			try {
				checkUser.set(dataJSON)
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-allow',
					status_resp: dateMileToDefault(dateClickInitial, 'time'),
				})
			} catch (error) {
				res.status(400).send({
					status_msg: 'error',
					status_msg_declaration: 'click-allow-error-1',
					status_resp: error,
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
						/**
						 * AQUI PRECISO FAZER UM AJUSTE PARA...
						 * BLOCKLEVEL estiver 0
						 * CLICKS > 0
						 * nao "zerar" os clicks apos clicado na expiração
						 * o mesmo vai valer para a área de deleteClick ( que ficará pelo python )
						 * na finalização dos comandos ( como um decorator )
						 *
						 * >> CORRIGIR E CONTINUAR <<
						 *
						 */

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
						const updateUserById = collectionClick.doc(userId).update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'click-allow',
							status_resp: dateMileToDefault(dateClickExpiration, 'time'),
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'error',
							status_msg_declaration: 'click-allow-error-2',
							status_resp: error,
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
							const updateUserById = collectionClick.doc(userId).update(data)

							res.status(401).send({
								status_msg: 'flood',
								status_msg_declaration: 'click-flood-warning',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-warning-error',
								status_resp: error,
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
								const updateUserById = collectionClick.doc(userId).update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-1',
								status_resp:
									configEnv('FLOOD_1_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-1-error',
								status_resp: error,
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
								const updateUserById = collectionClick.doc(userId).update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-2',
								status_resp:
									configEnv('FLOOD_2_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-2-error',
								status_resp: error,
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
								const updateUserById = collectionClick.doc(userId).update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-3',
								status_resp:
									configEnv('FLOOD_3_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-3-error',
								status_resp: error,
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
								const updateUserById = collectionClick.doc(userId).update(data)
							}

							res.status(401).send({
								status_msg: 'blocked',
								status_msg_declaration: 'click-flood-block-4',
								status_resp:
									configEnv('FLOOD_4_TIMEOUT') +
									'/' +
									dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-4-error',
								status_resp: error,
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
										.doc(userId)
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
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-flood-block-5-error',
								status_resp: error,
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
							const updateUserById = collectionClick.doc(userId).update(data)

							res.status(401).send({
								status_msg: 'denied',
								status_msg_declaration: 'click-denied',
								status_resp: dateMileToDefault(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'error',
								status_msg_declaration: 'click-denied-error',
								status_resp: error,
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
					const updateUserById = collectionClick.doc(userId).update(data)

					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'click-allow',
						status_resp: dateMileToDefault(dateClickInitial, 'time'),
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-in-execution-error',
						status_resp: error,
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
	cors(corsOptions),
	async (req, res) => {
		// pegar o userId vindo do POST ( pelo CORE )
		const userId = req.body.userId

		// define a data Expired como a data de agora
		const dateClickNow = dateFunc()

		const checkUser = collectionClick.doc(userId)
		checkUser.get().then((doc) => {
			// verifica se o usuario existe - caso não, faz o cadastro
			if (doc.exists) {
				try {
					// sleep para da um "extra delay" na liberação do usuário
					sleepFunc(1000)

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
						const updateUserById = collectionClick.doc(userId).update(data)

						res.status(200).send({
							status_msg: 'allow',
							status_msg_declaration: 'click-updated',
							status_resp: dateMileToDefault(dateClickNow, 'time'),
						})
					}
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-updated-error',
						status_resp: error,
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-updated',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
				})
			}
		})
	}
)

/**
 * função para ADM, que ira liberar o usuario de forma manual se precisar
 */
app.post(
	'/updateAdmClick',
	authMiddleware,
	cors(corsOptions),
	async (req, res) => {
		// pegar o userId vindo do POST ( pelo CORE )
		const userId = req.body.userId

		// define a data Expired como a data de agora
		const dateClickNow = dateFunc()

		const checkUser = collectionClick.doc(userId)
		checkUser.get().then((doc) => {
			// verifica se o usuario existe - caso não, faz o cadastro
			if (doc.exists) {
				try {
					// sleep para da um "extra delay" na liberação do usuário
					sleepFunc(1000)

					const data = {
						clicks: 0,
						status: 'off',
						blockLevel: 0,
						expiredAt: dateClickNow,
						updatedAt: dateClickNow,
					}
					// aqui faz a atualização zerando o score do usuario
					const updateUserById = collectionClick.doc(userId).update(data)

					res.status(200).send({
						status_msg: 'allow',
						status_msg_declaration: 'click-updated',
						status_resp: dateMileToDefault(dateClickNow, 'time'),
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'error',
						status_msg_declaration: 'click-updated-error',
						status_resp: error,
					})
				}
			} else {
				res.status(200).send({
					status_msg: 'allow',
					status_msg_declaration: 'click-updated',
					status_resp: dateMileToDefault(dateClickNow, 'time'),
				})
			}
		})
	}
)

/**
 * health check
 * area usada para verificar a saude da API, retornando...
 * 200 = success
 * 503 = service unavailable
 */
app.get('/healthCheckApi', cors(corsOptions), async (req, res) => {
	try {
		res.status(200).send({
			status_msg: 'health',
			status_resp: dateMileToDefault(dateFunc(), 'date') + ' UTC',
		})
	} catch (error) {
		res.status(503).send({
			status_msg: 'error',
			status_resp: error,
		})
	}
})

app.listen(port, () => console.log(`API is running on Port :: ${port}`))
