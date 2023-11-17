const express = require('express')
const app = express()
const admin = require('firebase-admin')
const credentials = require('../creds.json')

require('dotenv').config()
const port = process.env.NODE_LOCAL_PORTS

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
const dateMile = (timestamp, type) => {
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
		// faz o split e subtração da hora p/ corr
		// dateFormat =
		// 	result[0] - process.env.TIME_SYNC_GMT + ':' + result[1] + ':' + result[2]
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
 * lista todos os clicks feitos
 * POS : buscar como listar apenas 5 registros ( limit )
 * POS : buscar como listar um "id" especifico ou "userId"
 * POS : buscar como fazer SUM de uma "coluna" para poder contabilizar o total
 * de clicks
 */
// app.get('/listClicks', async (req, res) => {
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

/**
 * list one userId
 */
// app.get('/listClick/:id', async (req, res) => {
// 	try {
// 		const getUserById = collectionClick.doc(req.params.id)
// 		const response = await getUserById.get()

// 		console.log(response.data())

// 		res.status(200).send({
// 			status_msg: 'success!',
// 			resp: { id: response.id, ...response.data() },
// 		})
// 	} catch (error) {
// 		res.status(403).send({ status_msg: 'fail!', resp: error })
// 	}
// })

/**
 * add novo click feito
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 * //add custom id
	const response = collectionClick.doc(id).set(dataJSON)
 */

app.post('/addClick', async (req, res) => {
	// pegar o userId
	const userId = req.body.userId

	// cria uma nova data de expiração ( baseado no time )
	const dateClickNow = dateFunc()
	// usa o tempo default do FLOOD_TIMEOUT_DEFAULT, para uma expiração máxima
	//FIXME: verificar porque quando coloco o .env abaixo, ele da valor diferente
	const dateClickInitial = dateFunc('+', 10)

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
					status_msg: 'click-registered',
					status_resp: 'click registrado, usuário inserido nas regras',
				})
			} catch (error) {
				res.status(400).send({
					status_msg: 'click-registered-error',
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
							if (process.env.FLOOD_INTENSITY == 1) {
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
							status_msg: 'click-allow',
							status_resp: 'próximo clique liberado',
						})
					} catch (error) {
						res.status(400).send({
							status_msg: 'click-allow-error',
							status_resp: error,
						})
					}
				} else {
					// verifica quantos clicks ja foram dados p/ alertar ao usuario sobre o Flood
					// cada flood tera um clique limit + tempo em ( min )
					const flood_0_limit = process.env.FLOOD_0_LIMIT
					const flood_1_limit = process.env.FLOOD_1_LIMIT
					const flood_2_limit = process.env.FLOOD_2_LIMIT
					const flood_3_limit = process.env.FLOOD_3_LIMIT
					const flood_4_limit = process.env.FLOOD_4_LIMIT
					const flood_5_limit = process.env.FLOOD_5_LIMIT

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
								status_msg: 'click-flood-warning',
								status_resp:
									'você está cometendo flood, evite bloqueio. clique após : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-warning-error',
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
								status_msg: 'click-flood-block-1',
								status_resp:
									'bloqueado por : ' +
									process.env.FLOOD_1_TIMEOUT +
									'/min | você será desbloqueado as : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-block-1-error',
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
								status_msg: 'click-flood-block-2',
								status_resp:
									'bloqueado por : ' +
									process.env.FLOOD_2_TIMEOUT +
									'/min | você será desbloqueado as : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-block-2-error',
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
								status_msg: 'click-flood-block-3',
								status_resp:
									'bloqueado por : ' +
									process.env.FLOOD_3_TIMEOUT +
									'/min | você será desbloqueado as : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-block-3-error',
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
								status_msg: 'click-flood-block-4',
								status_resp:
									'bloqueado por : ' +
									process.env.FLOOD_4_TIMEOUT +
									'/min | você será desbloqueado as : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-block-4-error',
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
								status_msg: 'click-flood-block-5',
								status_resp:
									'bloqueado por : ' +
									process.env.FLOOD_5_TIMEOUT +
									'/min | você será desbloqueado as : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-flood-block-5-error',
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
								status_msg: 'click-denied',
								status_resp:
									'evite bloqueio, clique após : ' +
									dateMile(dateClickExpiration, 'time'),
							})
						} catch (error) {
							res.status(400).send({
								status_msg: 'click-denied-error',
								status_resp: error,
							})
						}
					}
				}
			} else {
				// status atual : off
				// faz o status : on ( novamente ), pois aqui o usuário voltou a clicar
				try {
					const data = {
						status: 'on',
						expiredAt: dateClickInitial,
					}

					// aqui faz a atualização com o status on + data do expiredAt p/ expiração
					const updateUserById = collectionClick.doc(userId).update(data)

					res.status(200).send({
						status_msg: 'click-in-execution',
						status_resp: dateMile(dateClickInitial, 'time'),
					})
				} catch (error) {
					res.status(400).send({
						status_msg: 'click-in-execution-error',
						status_resp: error,
					})
				}
			}
		}
	})
})

/**
 * atualiza o status para = off quando o comando da request for finalizada do lado Bot Python
 *
 */
app.post('/updateClick', async (req, res) => {
	// pegar o userId
	const userId = req.body.userId
	// define a data Expired como a data de agora
	const dateClickNow = dateFunc()

	const checkUser = collectionClick.doc(userId)
	checkUser.get().then((doc) => {
		// verifica se o usuario existe - caso não, faz o cadastro
		if (doc.exists) {
			try {
				// sleep para da um "extra delay"
				sleepFunc(500)

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
					status_msg: 'click-updated-1',
					status_resp: 'click atualizado, usuário liberado para clicar [1]',
				})
			} catch (error) {
				res.status(400).send({
					status_msg: 'click-updated-error',
					status_resp: error,
				})
			}
		} else {
			res.status(200).send({
				status_msg: 'click-updated-2',
				status_resp: 'click atualizado, usuário liberado para clicar [2]',
			})
		}
	})
})

/**
 * atualiza o status para = off quando o comando da request for finalizada do lado Bot Python
 *
 */
// app.patch('/updateClick/:id', async (req, res) => {
// 	try {
// 		const data = req.body
// 		const updateUserById = await collectionClick.doc(req.params.id).update(data)

// 		res.status(200).send({ status_msg: 'success!', resp: updateUserById })
// 	} catch (error) {
// 		res.status(403).send({ status_msg: 'fail!', resp: error })
// 	}
// })

// app.post('/addClickold', async (req, res) => {
// 	try {
// 		// const id = uuidv4()
// 		const data = req.body
// 		const userId = req.body.userId

// 		// array com itens adicionados
// 		const dataJSON = {
// 			userId: userId,
// 			count: 1,
// 			status: 'on',
// 			createdAt: dateFunc(),
// 			expiredAt: dateFunc(),
// 			updatedAt: 'NULL',
// 		}
// 		// add unique id
// 		// const response = collectionClick.add(dataJSON)
// 		const response = collectionClick.doc(userId).set(dataJSON)

// 		res.status(200).send({ status_msg: 'success!', resp: response })
// 	} catch (error) {
// 		res.status(403).send({ status_msg: 'fail!', resp: error })
// 	}
// })

/**
 * delete click existente
 */
// app.delete('/deleteClick/:id', async (req, res) => {
// 	try {
// 		const response = await collectionClick.doc(req.params.id).delete()

// 		res.status(200).send({ status_msg: 'success!', resp: response })
// 	} catch (error) {
// 		res.status(403).send({ status_msg: 'fail!', resp: error })
// 	}
// })

app.listen(port, () => console.log(`Server has started on port: ${port}`))
