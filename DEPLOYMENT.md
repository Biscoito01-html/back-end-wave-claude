# DEPLOYMENT — OpenClaude (uso interno corporativo)

Runbook mínimo para rodar o OpenClaude em um servidor Linux para funcionários
internos e de confiança. Cobre o mínimo necessário de segurança, banco,
backups, processos e TLS. **Não** cobre cenário SaaS público (sandbox OS-level
do Bun, quota efetiva, auditoria avançada etc. ficam para outra iteração).

---

## 1. Pré-requisitos

- Linux (Debian 12 / Ubuntu 22.04+ testados) ou Windows Server com WSL2.
- Node.js 20 LTS.
- [Bun](https://bun.sh) 1.1+.
- PostgreSQL 14+.
- Caddy 2.7+ **ou** Nginx + certbot (para TLS).
- (Opcional) [PM2](https://pm2.keymetrics.io/) ou systemd para manter os
  processos vivos.

## 2. Gerar secrets

Gere valores reais para `JWT_SECRET` e `ENCRYPTION_SECRET`. O backend se
recusa a subir em produção com os placeholders do `.env.example`.

```bash
# JWT_SECRET: 48 bytes em base64url (>= 32 chars)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# ENCRYPTION_SECRET: exatamente 32 caracteres
node -e "console.log(require('crypto').randomBytes(24).toString('base64').slice(0,32))"
```

PowerShell:

```powershell
# JWT_SECRET
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)) -replace '\+','-' -replace '/','_' -replace '='

# ENCRYPTION_SECRET (32 chars exatos)
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).Substring(0,32)
```

Guarde esses valores num gerenciador de segredos (Bitwarden, 1Password,
Vault). Perder o `ENCRYPTION_SECRET` invalida **todas** as chaves API
criptografadas no banco (ApiKey, UserIntegration).

## 3. Popular `.env` de produção

Copie o `.env.example` para `.env` no diretório do backend e ajuste:

```dotenv
NODE_ENV=production
PORT=3002
BACKEND_URL="https://openclaude.suaempresa.com"
FRONTEND_URL="https://openclaude.suaempresa.com"

DATABASE_URL="postgresql://openclaude:SENHA_FORTE@localhost:5432/openclaude?schema=public"

JWT_SECRET="<valor real gerado>"
JWT_EXPIRES_IN="7d"
ENCRYPTION_SECRET="<32 chars reais>"

OPENCLAUDE_HTTP_HOST="127.0.0.1"
OPENCLAUDE_HTTP_PORT="50052"
HTTP_PORT="50052"

WORKSPACES_ROOT="/var/openclaude/workspaces"

DISABLE_PUBLIC_REGISTER=true
```

`chmod 600 .env` e dono apenas do usuário que roda o processo.

## 4. Banco de dados

```bash
# Como usuário postgres ou com permissões adequadas
createuser -P openclaude
createdb -O openclaude openclaude

# Aplicar migrations
cd back-end/openclaude
npx prisma generate
npx prisma migrate deploy
```

## 5. Primeiro admin

Existe um seed em `prisma/seed.ts`. Configure as credenciais no arquivo (ou
use variáveis de ambiente conforme o script suporta) e rode:

```bash
npx ts-node prisma/seed.ts
```

Troque a senha do admin no primeiro login pelo painel.

## 6. Backfill de workspaces (para instalações com usuários pré-existentes)

Se você migrou de uma versão anterior sem `WorkspaceService`, rode uma vez:

```bash
npx ts-node src/workspace/backfill.ts
```

Cria `${WORKSPACES_ROOT}/<userId>/` para cada usuário existente.

## 7. Reverse proxy + TLS (Caddy)

`Caddy` é o jeito mais simples. Exemplo de `/etc/caddy/Caddyfile`:

```caddy
openclaude.suaempresa.com {
    encode zstd gzip
    reverse_proxy /api/* 127.0.0.1:3002
    reverse_proxy 127.0.0.1:8080
}
```

Ou sirva o `front-end/dist` como static e só proxie `/api/*` para o Nest.

Recarregue: `sudo systemctl reload caddy`.

### Alternativa: Nginx + certbot

```nginx
server {
  listen 443 ssl http2;
  server_name openclaude.suaempresa.com;

  ssl_certificate     /etc/letsencrypt/live/openclaude.suaempresa.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/openclaude.suaempresa.com/privkey.pem;

  client_max_body_size 25M;

  location /api/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_buffering off;   # SSE do /chat/stream precisa disso
  }

  location / {
    root /var/www/openclaude-frontend;
    try_files $uri /index.html;
  }
}
```

## 8. Process manager (PM2)

`ecosystem.config.js` no repo raiz do backend:

```js
module.exports = {
  apps: [
    {
      name: 'openclaude-nest',
      cwd: '/opt/openclaude/back-end/openclaude',
      script: 'dist/main.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      kill_timeout: 5000,
    },
    {
      name: 'openclaude-bun',
      cwd: '/opt/openclaude/openclaude',
      script: 'bun',
      args: 'scripts/start-http-stream.ts',
      env: { NODE_ENV: 'production', HTTP_PORT: '50052' },
      max_memory_restart: '2G',
    },
  ],
};
```

Subir:

```bash
cd back-end/openclaude
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # gera comando para systemd
```

> **Bun só escuta em `127.0.0.1`**. A validação de boot bloqueia
> `OPENCLAUDE_HTTP_HOST=0.0.0.0` em produção. Confirme com
> `ss -tlnp | grep 50052` — deve aparecer `127.0.0.1:50052`, **nunca**
> `0.0.0.0:50052` ou `:::50052`.

## 9. Backup do Postgres

Cron diário às 03:00 com rotação de 14 dias:

```cron
0 3 * * * /usr/bin/pg_dump -U openclaude -Fc openclaude \
  | gzip > /var/backups/openclaude/pg-$(date +\%Y\%m\%d).dump.gz \
  && find /var/backups/openclaude -name 'pg-*.dump.gz' -mtime +14 -delete
```

Restauração: `gunzip -c <arquivo> | pg_restore -U openclaude -d openclaude`.

Teste a restauração num ambiente separado **pelo menos uma vez por mês**.

## 10. Backup dos workspaces

Os workspaces (`/var/openclaude/workspaces/<userId>/`) contêm código que os
usuários podem ter gerado mas não comitado em Git. Faça snapshot:

```cron
30 3 * * * /usr/bin/rsync -aHx --delete /var/openclaude/workspaces/ \
  /mnt/backup/openclaude-workspaces/
```

Ou envie para S3 com `aws s3 sync` / `rclone sync`.

## 11. NUNCA exponha o Prisma Studio em produção

`npx prisma studio` roda sem autenticação em `localhost:5555` e permite
editar qualquer linha de qualquer tabela, incluindo senhas e chaves. Em
produção:

- **NUNCA** deixe `prisma studio` rodando como processo de fundo.
- **NUNCA** proxie `5555` pelo Caddy/Nginx.
- Se precisar inspecionar dados, use túnel SSH local:
  `ssh -L 5555:127.0.0.1:5555 servidor` e rode o Studio manualmente lá,
  fechando assim que terminar.

## 12. Rotação de secrets

Rotacionar `ENCRYPTION_SECRET` exige reencriptar todas as colunas cifradas.
Procedimento manual:

1. Rodar backup completo do banco (seção 9).
2. Escrever script ad-hoc que, usando o valor **antigo**, decifra
   `ApiKey.encryptedKey` e `UserIntegration.encryptedToken`.
3. Trocar `ENCRYPTION_SECRET` no `.env`.
4. Rodar segundo script que reencrypta com o valor novo.
5. Restart do backend.

Rotação de `JWT_SECRET` invalida todas as sessões ativas (usuários precisam
relogar) — aceitável na maioria dos casos; basta trocar e reiniciar.

## 13. Checklist pós-deploy

- [ ] `curl https://openclaude.suaempresa.com` responde 200 e serve o
      `index.html`.
- [ ] Login com o admin seedado funciona.
- [ ] Criar um usuário de teste pelo painel admin cria a pasta
      `${WORKSPACES_ROOT}/<userId>/` em disco.
- [ ] Abrir um chat, enviar mensagem, e confirmar que a resposta chega em
      streaming.
- [ ] `ss -tlnp | grep 50052` mostra apenas `127.0.0.1:50052`.
- [ ] `curl https://openclaude.suaempresa.com/api/auth/login` com body vazio
      retorna 400, e 6 tentativas seguidas retornam 429 (rate limit
      funcionando).
- [ ] `POST /api/auth/register` retorna 403 (`DISABLE_PUBLIC_REGISTER=true`).
- [ ] Certificado TLS válido (`curl -vI` mostra LE/zerotrust OK).
- [ ] `pg_dump` manual funciona e restore num DB temporário também.
- [ ] Prisma Studio **NÃO** está acessível externamente
      (`curl http://servidor:5555` deve falhar).

## 14. Escopo intencionalmente NÃO coberto

Estes itens são recomendados se o serviço sair do círculo de "funcionários
internos de confiança":

- Sandbox OS-level do Bun (Docker/firejail/gVisor) para isolar execução de
  comandos arbitrários entre usuários.
- Quota real de disco por usuário (`diskUsage` já é reportado, mas sem
  enforcement).
- Tabela de auditoria para ações admin (criar/remover usuário, alterar
  chave, mudar GlobalSettings).
- Observabilidade (Sentry para erros, Prometheus/Grafana para métricas).
- MFA / SSO corporativo (SAML/OIDC).
- Rotação automática de `ENCRYPTION_SECRET`.
