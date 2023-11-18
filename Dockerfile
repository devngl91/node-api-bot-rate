# Baixa a imagem do node com versão alpine (versão mais simplificada e leve)
FROM node:alpine

# Cria pasta e define o local onde o app vai ficar no disco do container
RUN mkdir -p /usr/app
WORKDIR /usr/app

# Atualiza as dependencias + add git + bash
RUN apk update && apk upgrade
RUN apk add git
RUN apk add bash

# Copia tudo que começa com package e termina com .json para dentro da pasta /usr/app
COPY package*.json ./

# Executa npm install para adicionar as dependências e criar a pasta node_modules
RUN npm install

# Copia tudo do dir local para o dir do container
COPY . .

# Container ficará ouvindo os acessos na porta 3000
EXPOSE 3000

# Executa o comando npm start para iniciar o script que que está no package.json
CMD npm start