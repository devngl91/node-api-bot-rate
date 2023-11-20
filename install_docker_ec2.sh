#!/bin/bash
# SSM user didn't start in the home directory, so go there

cd

sudo apt update -y

sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable

sudo apt install docker.io git -y

# install node latest + npm latest
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=20

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt-get update && sudo apt-get install nodejs -y

sudo npm install -g nodemon

sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

sudo chmod +x /usr/local/bin/docker-compose

sudo service docker start

sudo chmod 666 /var/run/docker.sock

git clone https://github.com/devngl91/node-api-bot-rate.git

cd node-api-bot-rate

npm install

docker-compose up -d