# Salas

Uma sala é o lugar onde a gente se encontra: um código, as pessoas dentro dela, o chat e as transmissões. Ela vive **na memória do servidor de sinalização** e some quando o servidor reinicia. Não há banco, cadastro nem conta — o código é o convite.

O vídeo nunca passa pelo servidor: ele vai direto de quem compartilha para quem assiste (WebRTC P2P). O servidor só sabe quem está em qual sala e distribui a sinalização.

## Sala aleatória e sala fixa

| | Sala aleatória | Sala fixa |
| --- | --- | --- |
| Código | 6 caracteres sorteados pelo servidor a cada sala nova | sempre `BOTECO` |
| Quando existe | quando alguém pede "criar sala" | desde o boot do servidor |
| Quem entra | quem tiver o código | quem souber o código `BOTECO` |
| Fica vazia | espera `ROOM_EMPTY_GRACE_MS` e é removida | nunca é removida, mesmo vazia |

O código aleatório sai do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — sem `I`, `1`, `O` e `0`, que se confundem na tela. O servidor nunca sorteia um código que já exista nem o `BOTECO`.

A sala fixa é criada quando o servidor sobe (`server/index.mjs`) e carrega `isFixed: true`. Esse sinalizador faz duas coisas: ela não passa pelo temporizador de sala vazia e o histórico dela nunca é apagado por remoção automática. Por isso o `BOTECO` funciona como ponto de encontro permanente: compartilhe o mesmo código com todo mundo, sempre.

Para entrar, o servidor normaliza o que foi digitado (`toUpperCase()` + `trim()`). No navegador, `cleanCode()` (`web/src/lib/utils.ts`) remove traço e espaço, joga para maiúsculas e corta em 6 caracteres; `formatCode()` mostra o código como `ABC-DEF`.

Uma sala pode ter **senha**: quem cria define, quem entra precisa mandar a mesma senha, senão o servidor recusa o `join-room`. A senha é opcional e vale só para aquela sala.

## Chat por sala

O chat é do escopo da **sala**, não da transmissão: trocar de stream não muda o chat, e sair da sala sai do chat. O histórico continua quando alguém entra depois.

O servidor trata a mensagem antes de entregar a ela:

- **Sanitização** — remove caracteres de controle (exceto a quebra de linha), apara os espaços das pontas e corta em **500 caracteres** (`CHAT_MAX_LENGTH`).
- **Rate limit** — o mesmo peer só manda uma mensagem a cada **500 ms** (`CHAT_RATE_LIMIT_MS`). Mensagem enviada antes disso é descartada em silêncio.
- **Histórico** — a sala guarda as **50 últimas mensagens** (`CHAT_HISTORY_LIMIT`) e entrega o lote no `join-room`.

Nada disso é persistido: o histórico vive na memória do servidor e é perdido quando a sala é removida.

## Sessão, F5 e a sala que fica de pé

O app guarda a sessão da sala no `sessionStorage` do navegador, na chave `telinha-room-session`, com validade de **12 horas** (`SESSION_TTL`, `web/src/lib/session.ts`). Ao recarregar a página (F5), o app reentra sozinho na mesma sala, com o mesmo apelido.

A reconexão tem **6 segundos** de paciência (`RECONNECT_TIMEOUT_MS`, `web/src/App.tsx`). Sem resposta do servidor nesse tempo, a tela vira o estado de falha do componente `Reconnecting`, com o botão **"Tentar de novo"**, que reenvia o `join-room` e arma o timeout de novo.

Do lado do servidor, a sala que ficou vazia **não é removida na hora**: ela espera `ROOM_EMPTY_GRACE_MS` (padrão **30 s**, ajustável por variável de ambiente). Quem deu F5 volta dentro dessa janela e ainda encontra a sala e o histórico do chat. Se alguém voltou, a remoção pendente é cancelada. A sala fixa é imune a esse temporizador.

## Grade de até 4 transmissões

Cada sala mostra **até 4 transmissões ao mesmo tempo**. O limite é rígido no cliente: o app guarda quem já foi solicitado (`requestedSharersRef`) e não pede um quinto stream ao servidor. Quando o limite é atingido, aparece o aviso **"Máximo de 4 transmissões simultâneas"** — na sidebar da sala e no palco.

A limitação é de **visualização**, não de quem compartilha:

- quem transmite não é interrompido — o 5º transmissor continua no servidor e **continua listado na sidebar**, marcado como *fora da grade*;
- dá para **abrir essa transmissão sozinha**, em tela cheia, pelo modo foco;
- o aviso não some ninguém da sala.

Na grade (2 a 4 streams):

- **clicar num tile** (botão `open_in_full` no canto, ou `zoom_out_map` no rodapé) abre aquela transmissão em tela cheia; **"Voltar à grade"** (`arrow_back`) traz a grade de volta;
- o painel de diagnóstico abre só sobre a stream **em foco**; na grade ele fecha;
- cada tile tem **volume, mudo e zoom próprios** (de 100% a 200%) — um tile não mexe no som do outro;
- o **X** do tile **só oculta da grade localmente**: não derruba a transmissão de quem compartilha. O `Room` avisa o app (`onStreamRemoved`), o app para de receber aquela stream e **devolve o slot**, então outro stream pode ser pedido;
- no celular (abaixo de 640 px) a grade vira uma coluna empilhada em 16:9, com rolagem vertical.

Quem compartilha também pode trocar a resolução da live durante a transmissão — ver [`diagnostics.md`](diagnostics.md) para o que cada número de qualidade significa.

## Onde ficam as constantes

| Constante | Onde | Valor |
| --- | --- | --- |
| `FIXED_ROOM_CODE` | `web/src/lib/constants.ts` **e** `server/index.mjs` | `BOTECO` |
| `MAX_SIMULTANEOUS_STREAMS` | `web/src/lib/constants.ts` | `4` |
| `ROOM_EMPTY_GRACE_MS` | `server/index.mjs` (env) | `30000` ms |
| `CHAT_MAX_LENGTH` | `server/index.mjs` | `500` |
| `CHAT_HISTORY_LIMIT` | `server/index.mjs` | `50` |
| `CHAT_RATE_LIMIT_MS` | `server/index.mjs` | `500` ms |
| `SESSION_TTL` | `web/src/lib/session.ts` | 12 h |
| `RECONNECT_TIMEOUT_MS` | `web/src/App.tsx` | `6000` ms |

`FIXED_ROOM_CODE` é a única constante duplicada: ela existe no cliente e no servidor, e as duas cópias precisam ficar em sincronia — mudar uma sem a outra quebra o acesso à sala fixa. O limite de 4 transmissões é do cliente (`MAX_SIMULTANEOUS_STREAMS`): ele segura o número de streams *pedidos* por sala, e o servidor não impõe teto de transmissões.

O endereço do servidor de sinalização é outra variável, e essa é de build: `VITE_SIGNAL_HOST` (só o host, sem esquema e sem porta), lida em `web/src/lib/utils.ts` (`getSignalingHost` / `getSignalingUrl`). Sem ela, o app cai no fallback `${hostname}:4000`.
