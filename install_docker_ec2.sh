#!/bin/bash
# SSM user didn't start in the home directory, so go there

cd
sudo yum update -y
# install docker + git
sudo yum install docker git npm -y
sleep 2
# instala o docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sleep 2
# da permissão no docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sleep 2
# da permissão no docker.sock
sudo chmod 666 /var/run/docker.sock
sleep 5
# pega o projeto do git
git clone https://github.com/devngl91/ec2-test-node.git
cd ec2-test-node.git
# da permissão
sudo chmod -R 755 .
sleep 2
# inicia o docker
docker-compose up -d