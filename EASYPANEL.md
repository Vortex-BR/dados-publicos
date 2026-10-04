# Publicação no Easypanel

## 1. Banco PostgreSQL

1. Crie ou abra um projeto no Easypanel.
2. Adicione um serviço **Postgres** chamado, por exemplo, `tse-postgres`.
3. Defina o banco como `campania_tse` e mantenha o serviço sem porta pública.
4. Em **Credentials**, copie a URL interna de conexão.
5. Configure backups lógicos diários e teste uma restauração antes da eleição.

## 2. Aplicação

Crie um serviço **App** chamado `tse-api`.

### Usando o repositório

- Source: GitHub/Git;
- Build Path: `/easypanel/tse-collector`;
- Builder: Dockerfile;
- Dockerfile: `Dockerfile`.

### Usando o ZIP gerado

- Source: Upload;
- envie `campania-ninja-tse-collector-*.zip`;
- Builder: Dockerfile;
- Dockerfile: `Dockerfile`.

## 3. Variáveis

Cadastre no serviço App:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
DATABASE_URL=URL_INTERNA_COPIADA_DO_POSTGRES
DATABASE_SSL=false
API_KEYS=CHAVE_DE_LEITURA_COM_32_OU_MAIS_CARACTERES
ADMIN_API_KEY=OUTRA_CHAVE_COM_32_OU_MAIS_CARACTERES
CORS_ORIGINS=https://crm.newtonbonin.com.br
AUTO_SYNC_ENABLED=true
TSE_ENVIRONMENT=oficial
TSE_POLL_INTERVAL_SECONDS=5
TSE_REQUEST_TIMEOUT_SECONDS=15
TSE_NEWTON_BONIN_SQ_CANDIDATO=160002540768
TSE_NEWTON_BONIN_NUMERO=1023
```

Gere cada chave com:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Não use `TSE_ENVIRONMENT=simulado` em produção. Depois da consolidação do registro de candidatura, preencha preferencialmente o SQ Candidato de Newton Bonin.

## 4. Domínio e saúde

1. Use o domínio HTTPS `dados-publicos-tse.fwotmy.easypanel.host`.
2. Direcione-o para a porta interna `3000` usando protocolo HTTP.
3. Use `/health/ready` como verificação de prontidão.
4. Não publique a porta `5432` do PostgreSQL.

O serviço pode ter mais de uma réplica: a trava consultiva no PostgreSQL garante que somente uma execute o ciclo de coleta.

## 5. WordPress

Adicione as três constantes descritas no README ao `wp-config.php` e atualize o plugin Campania Ninja Core. Teste:

```bash
curl https://tse-api.seudominio.com.br/health/ready
curl -H "X-API-Key: CHAVE_DE_LEITURA" https://tse-api.seudominio.com.br/v1/apuracao
```

Depois abra `/#/apuracao` no CRM. A resposta deve incluir:

```json
{
  "source": { "exclusive": true, "environment": "oficial" },
  "collector": { "storage": "postgresql" }
}
```
