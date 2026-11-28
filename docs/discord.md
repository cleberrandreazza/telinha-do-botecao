# Integração Discord — Telinha do Botecão

## Fluxo

1. Uma pessoa executa `/telinha` dentro de um canal de voz.
2. O bot cria ou reutiliza uma sala associada ao servidor e ao canal de voz e publica um link compartilhável.
3. Os botões abrem o servidor de sinalização. Se o navegador já tem o cookie da sessão, a autorização do Discord não aparece de novo. Sem cookie, o backend inicia OAuth2.
4. O OAuth solicita somente o escopo `identify`. O callback salva o refresh token criptografado no PostgreSQL, cria uma sessão server-side e grava o cookie `telinha_discord` no servidor.
5. **Entrar pelo navegador** volta ao site com um código temporário de uso único (2 minutos). O frontend troca esse código por uma sessão via POST e guarda o token no `localStorage`, para o próximo clique do Discord não pedir autorização. **Abrir aplicativo** redireciona para `telinha://sala/<CODIGO>?discord_code=<código>`. O app troca o código e entra na mesma sala. O token de sessão nunca vai na URL.
6. Ao entrar na sala, o backend valida a sessão e confirma que o usuário ainda está no mesmo canal de voz usando o estado recebido do gateway Discord. A renovação de refresh token é serializada por usuário para evitar corridas.
7. O evento `voiceStateUpdate` encerra a conexão Telinha quando o usuário sai do canal ou muda para outro canal.

OAuth identifica a conta Discord; não é um convite individual nem substitui a verificação de presença ao vivo.

## Privacidade e compatibilidade

- `/telinha` não possui opção `privada`.
- O Discord não cria, recebe nem armazena senhas Telinha.
- O fluxo normal de salas públicas, privadas e protegidas por senha permanece no frontend/backend Telinha.
- A autorização Discord não altera o fluxo de senha.
- O frontend não deve confiar em `source=discord` como autorização: o servidor valida a sessão e a presença no canal.
- O código da sala é transportado no caminho do link, sem exigir digitação; a interface deve ocultá-lo no modo de entrada Discord.

## Variáveis de ambiente

Configurar no serviço do backend (Render), nunca no frontend:

- `DATABASE_URL`: connection string pooled do Neon.
- `DISCORD_TOKEN_ENCRYPTION_KEY`: chave base64 de 32 bytes para AES-256-GCM.
- `DISCORD_CLIENT_ID`: Application ID do Discord.
- `DISCORD_CLIENT_SECRET`: segredo OAuth do Discord.
- `DISCORD_BOT_TOKEN`: token do bot.
- `DISCORD_REDIRECT_URI`: URL exata do callback, por exemplo `https://SEU-SERVICO.onrender.com/discord/callback`.
- `PUBLIC_WEB_URL`: origem HTTPS do frontend, por exemplo `https://telinha-do-botecao.vercel.app`.

No Discord Developer Portal, cadastrar a mesma `DISCORD_REDIRECT_URI` em OAuth2 Redirects. Solicitar somente `identify`.

Gerar a chave de criptografia localmente com:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Não versionar nem compartilhar `DATABASE_URL`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` ou `DISCORD_TOKEN_ENCRYPTION_KEY`.

## Persistência

O backend cria as tabelas `discord_authorizations`, `discord_voice_rooms`, `discord_web_sessions`, `discord_oauth_states` e `discord_login_codes` automaticamente na inicialização. Refresh tokens e os tokens de sessão temporários do fluxo de troca são cifrados com AES-256-GCM; sessões, estados OAuth e códigos de login são armazenados como hashes SHA-256. Códigos de login são de uso único e expiram em 2 minutos. A sessão dura 30 dias: o cookie fica no servidor de sinalização e uma cópia do token fica no `localStorage` do site, compartilhada entre as abas do mesmo navegador.

## Estado da implementação

A integração requer validação de ponta a ponta com as variáveis reais do Render/Neon e testes de browser/Tauri. Não considerar pronta para produção até esses testes passarem.
