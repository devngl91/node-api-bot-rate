const express = require('express')
const app = express()
const admin = require('firebase-admin')
const credentials = require('../creds.json')
const { v4: uuidv4 } = require('uuid')

require('dotenv').config()
const port = process.env.NODE_LOCAL_PORTS

admin.initializeApp({
	credential: admin.credential.cert(credentials),
})

const db = admin.firestore()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const collectionClick = db.collection(process.env.COLLECTION_CLICK)
const collectionRate = db.collection(process.env.COLLECTION_RATE)

/**
 * tratamento de data
 * default : null
 * +05 ( vai adicionar mais 5 segundos no time atual )
 * -05 ( vai retirar 5 segundos no time atual )
 */
const dateFunc = (date = null) => {
	if (!date) {
		date = Date.now()
	} else {
		date = Date.now()
	}
	return date
}

/**
 * lista todos os clicks feitos
 * POS : buscar como listar apenas 5 registros ( limit )
 * POS : buscar como listar um "id" especifico ou "userId"
 * POS : buscar como fazer SUM de uma "coluna" para poder contabilizar o total de clicks
 */
app.get('/listClicks', async (req, res) => {
	try {
		const response = await collectionClick.get()
		let responseArr = []
		response.forEach((doc) => {
			responseArr.push({ id: doc.id, ...doc.data() })
		})

		res.status(200).send({ msg: 'success!', resp: responseArr })
	} catch (error) {
		res.status(403).send({ msg: 'fail!', resp: error })
	}
})

/**
 * list one userId
 */
app.get('/listClick/:id', async (req, res) => {
	try {
		const getUserById = collectionClick.doc(req.params.id)
		const response = await getUserById.get()
		res
			.status(200)
			.send({ msg: 'success!', resp: { id: response.id, ...response.data() } })
	} catch (error) {
		res.status(403).send({ msg: 'fail!', resp: error })
	}
})

/**
 * add novo click feito
 * vira apenas
 * {
 *  "userId" : "idDoUser000"
 * }
 */

app.post('/addClick', async (req, res) => {
	try {
		// const id = uuidv4()
		const data = req.body

		// array com itens adicionados
		const dataJSON = {
			userId: req.body.userId,
			count: 1,
			status: 'on',
			createdAt: dateFunc(),
			expiredAt: dateFunc(),
			updatedAt: 'NULL',
		}

		//add custom id
		// const response = collectionClick.doc(id).set(dataJSON)

		// add unique id
		const response = collectionClick.add(dataJSON)

		res.status(200).send({ msg: 'success!', resp: response })
	} catch (error) {
		res.status(403).send({ msg: 'fail!', resp: error })
	}
})

/**
 * atualiza click existente pelo ID
 * USO = insere os campos que irá editar
 * {
 * "status" : "off"
 * }
 */
app.patch('/updateClick/:id', async (req, res) => {
	try {
		const data = req.body
		const updateUserById = await collectionClick.doc(req.params.id).update(data)

		res.status(200).send({ msg: 'success!', resp: updateUserById })
	} catch (error) {
		res.status(403).send({ msg: 'fail!', resp: error })
	}
})

/**
 * delete click existente
 */
app.delete('/deleteClick/:id', async (req, res) => {
	try {
		const response = await collectionClick.doc(req.params.id).delete()

		res.status(200).send({ msg: 'success!', resp: response })
	} catch (error) {
		res.status(403).send({ msg: 'fail!', resp: error })
	}
})

app.listen(port, () => console.log(`Server has started on port: ${port}`))
