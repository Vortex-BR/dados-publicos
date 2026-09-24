# Campania Ninja — Coletor TSE 2026

Serviço independente para Easypanel que consulta exclusivamente os arquivos JSON oficiais do TSE, normaliza os resultados e disponibiliza uma API protegida para o WordPress. O estado atual, o histórico de alterações e a auditoria das sincronizações ficam no PostgreSQL.

## Escopo fixo

- Presidente da República — Brasil;
- Deputado Federal — Paraná, com identificação específica de Newton Bonin;
- eventual segundo turno presidencial, descoberto pelo arquivo `ele-c.json` do TSE.

O serviço rejeita outros domínios, cargos e abrangências. No ambiente oficial, nenhuma consulta de resultados é feita antes de 4 de outubro de 2026 às 17h de Brasília.

## API

| Método | Rota                                         | Autenticação         | Uso                                |
| ------ | -------------------------------------------- | -------------------- | ---------------------------------- |
| `GET`  | `/health/live`                               | pública              | processo ativo                     |
| `GET`  | `/health/ready`                              | pública              | aplicação e PostgreSQL disponíveis |
| `GET`  | `/docs`                                      | pública              | documentação OpenAPI interativa    |
| `GET`  | `/openapi.json`                              | pública              | especificação OpenAPI              |
| `GET`  | `/v1/apuracao`                               | `X-API-Key`          | todos os resultados do escopo      |
| `GET`  | `/v1/apuracao/presidente`                    | `X-API-Key`          | somente Presidente                 |
| `GET`  | `/v1/apuracao/deputado-federal/newton-bonin` | `X-API-Key`          | somente Newton Bonin               |
| `POST` | `/v1/internal/sync`                          | chave administrativa | força um ciclo permitido de coleta |
| `GET`  | `/v1/internal/runs`                          | chave administrativa | últimas 50 execuções               |

Também é aceito `Authorization: Bearer CHAVE`. As chaves administrativas e de leitura precisam ser diferentes.

Exemplo:

```bash
curl -H "X-API-Key: SUA_CHAVE" https://tse-api.seudominio.com.br/v1/apuracao
```

## Garantias operacionais

- trava consultiva do PostgreSQL impede que réplicas coletem simultaneamente;
- `ETag` e `Last-Modified` evitam retransmissão de arquivos sem alteração;
- no máximo um ciclo por minuto por padrão;
- erros `404` ou `429` ativam recuo de dez minutos;
- uma versão histórica só é gravada quando o SHA-256 do arquivo muda;
- o último resultado válido continua disponível durante indisponibilidades do TSE;
- migrações são executadas automaticamente e de forma serializada na inicialização;
- encerramento por `SIGTERM` fecha HTTP, agenda e conexões PostgreSQL corretamente.

## Desenvolvimento local

Com Docker:

```bash
docker compose up --build
```

Sem Docker, configure um PostgreSQL em `.env` e execute:

```bash
npm ci
npm test
npm run build
npm start
```

O arquivo `.env.example` documenta todas as variáveis. Nunca publique `.env` ou as chaves da API.

## WordPress

No `wp-config.php`, antes de `wp-settings.php`:

```php
define('CAMPANIA_TSE_COLLECTOR_URL', 'https://tse-api.seudominio.com.br');
define('CAMPANIA_TSE_COLLECTOR_API_KEY', 'CHAVE_DE_LEITURA_COM_32_OU_MAIS_CARACTERES');
define('CAMPANIA_TSE_COLLECTOR_ADMIN_KEY', 'CHAVE_ADMIN_DIFERENTE_COM_32_OU_MAIS_CARACTERES');
```

Quando essas constantes estão presentes, o plugin interrompe seu WP-Cron eleitoral e usa somente o coletor central. A chave fica no PHP e não é enviada ao navegador.
