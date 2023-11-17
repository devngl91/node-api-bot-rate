const express = require('express')
// const { FieldValue } = require('firebase-admin/firestore')
const app = express()
app.use(express.json())
require('dotenv').config()
const { db } = require('./firebase.js')
const port = process.env.NODE_LOCAL_PORTS

const collectionClick = db.collection(process.env.COLLECTION_CLICK)
const collectionRate = db.collection(process.env.COLLECTION_RATE)

/**
 * lista todos os clicks feitos
 * POS : buscar como listar apenas 5 registros ( limit )
 * POS : buscar como listar um "id" especifico ou "userId"
 * POS : buscar como fazer SUM de uma "coluna" para poder contabilizar o total de clicks
 */
app.get('/listClicks', async (req, res) => {
	const clicks = await collectionClick.get()
	const list = clicks.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
	res.status(200).send(list)
})

/**
 * add novo click feito
 */

app.post('/addClick', async (req, res) => {
	const data = req.body
	console.log(data)
	const res2 = await collectionClick.add(data)
	res.status(200).send('success added!')
})

/**
 * atualiza click existente pelo ID
 */
app.patch('/updateClick', async (req, res) => {
	const id = req.body.id
	delete req.body.id // deleta o id p/ previnir de "tentar add novamente"
	const data = req.body
	await collectionClick.doc(id).update(data)

	res.status(200).send('success updated!')
})

/**
 * delete click existente
 */
app.delete('/deleteClick', async (req, res) => {
	const id = req.body.id
	await collectionClick.doc(id).delete()
	res.status(200).send('success deleted!')
})

app.listen(port, () => console.log(`Server has started on port: ${port}`))
