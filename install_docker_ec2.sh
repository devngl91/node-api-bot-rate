#!/bin/bash
cd
sudo yum update -y
sudo yum install docker git npm -y
sleep 2
sudo npm install nodemon
sleep 2
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sleep 2
sudo chmod +x /usr/local/bin/docker-compose
sleep 2
sudo service docker start
sudo chmod 666 /var/run/docker.sock
sleep 5
git clone https://github.com/devngl91/node-api-bot-rate-limit-9m8dya9osydn897abgsdnasdadasdas.git
cd node-api-bot-rate-limit-9m8dya9osydn897abgsdnasdadasdas
sudo chmod -R 755 .
sleep 2
docker-compose up -d