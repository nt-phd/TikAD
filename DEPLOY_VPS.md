# Deploy on VPS

This project is easiest to run on a VPS with:

- Ubuntu or Debian
- `nginx`
- `node`
- `texlive`
- `pdf2svg`

## 1. Install system packages

```bash
sudo apt-get update
sudo apt-get install -y nginx nodejs npm pdf2svg texlive-latex-base texlive-latex-recommended texlive-pictures texlive-science texlive-latex-extra
```

Optional but useful:

```bash
sudo apt-get install -y texlive-extra-utils
```

## 2. Create app directory

```bash
sudo mkdir -p /var/www/circuitikz-cad
sudo chown -R "$USER":"$USER" /var/www/circuitikz-cad
cd /var/www/circuitikz-cad
git clone <YOUR_REPO_URL> current
cd current
```

## 3. Install frontend dependencies

```bash
npm install
```

## 4. Configure frontend render URL

Create `.env.production`:

```bash
cat > .env.production <<'EOF'
VITE_RENDER_SERVER_URL=https://cad-render.example.com
EOF
```

Replace `cad-render.example.com` with your render subdomain.

## 5. Build the frontend

```bash
npm run build
```

## 6. Install the render server as a service

Copy the service file:

```bash
sudo cp deploy/circuitikz-render.service /etc/systemd/system/
```

If needed, edit:

- `User=www-data`
- `WorkingDirectory=/var/www/circuitikz-cad/current`

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable circuitikz-render
sudo systemctl start circuitikz-render
sudo systemctl status circuitikz-render
```

Health check:

```bash
curl http://127.0.0.1:3737/health
```

Expected:

```json
{"ok":true}
```

## 7. Configure nginx

Copy the template:

```bash
sudo cp deploy/nginx.circuitikz-cad.conf /etc/nginx/sites-available/circuitikz-cad
```

Edit the two domains:

- `cad.example.com`
- `cad-render.example.com`

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/circuitikz-cad /etc/nginx/sites-enabled/circuitikz-cad
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Add HTTPS

If DNS is already pointed to the VPS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx
```

Use certificates for both:

- app domain
- render domain

## 9. Update deployment

For each update:

```bash
cd /var/www/circuitikz-cad/current
git pull
npm install
npm run build
sudo systemctl restart circuitikz-render
sudo systemctl reload nginx
```

## 10. Recommended hardening

- Keep the render server bound to `127.0.0.1`
- Expose only nginx publicly
- Keep `client_max_body_size` small
- Consider nginx rate limiting on the render host
- Keep the VPS updated
