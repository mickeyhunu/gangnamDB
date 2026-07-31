cd Documents/aws
ssh -i .\mmnsKey.pem ubuntu@43.200.206.187 --- cmd에서 우분투 접속

sudo nano /etc/nginx/sites-available/gangnamDB  --- nginx reverse proxy 설정
sudo nano /etc/nginx/sites-available/gangnamDB-redirect


sudo ln -s /etc/nginx/sites-available/gangnamDB /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx --- 적용
pm2 restart gangnamDB


git fetch --all --prune
git pull --ff-only origin "main"
sudo nginx -t && sudo systemctl reload nginx --- 적용
pm2 restart gangnamDB