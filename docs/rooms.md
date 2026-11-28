# Salas

Uma sala é o lugar onde a gente se encontra: um código, as pessoas dentro dela, o chat e as transmissões. Ela vive **na memória do servidor de sinalização** e some quando o servidor reinicia. Não há banco, cadastro nem conta — o código é o convite.

O vídeo nunca passa pelo servidor: ele vai direto de quem compartilha para quem assiste (WebRTC P2P). O servidor só sabe quem está em qual sala e distribui a sinalização.

## A sala e seu código

Toda sala é criada sob demanda: quem pede "criar sala" recebe um **código de 6 caracteres sorteado pelo servidor**. Esse código é o convite — quem tiver o código entra.

| | Sala |
| --- | --- |
| Código | 6 caracteres sorteados pelo servidor a cada sala nova |
| Quando existe | quando alguém pede "criar sala" |
| Quem entra | quem tiver o código |
| Fica vazia | espera `ROOM_EMPTY_GRACE_MS` e é removida |

O código sai do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — sem `I`, `1`, `O` e `0`, que se confundem na tela. O servidor nunca sorteia um código que já exista.

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

Do lado do servidor, a sala que ficou vazia **não é removida na hora**: ela espera `ROOM_EMPTY_GRACE_MS` (padrão **30 s**, ajustável por variável de ambiente). Quem deu F5 volta dentro dessa janela e ainda encontra a sala e o histórico do chat. Se alguém voltou, a remoção pendente é cancelada.

### Identidade do chat depois do F5

O `peerId` que o servidor dá a cada conexão morre junto com a conexão: depois do F5 o app recebe um novo. Para que as mensagens próprias continuem do lado direito do chat, o app guarda um **clientId** estável no `sessionStorage` (chave `telinha-client-id`, `web/src/lib/session.ts`) e o envia em cada `chat-message`. O servidor guarda o `clientId` no histórico e o repassa no broadcast; o cliente compara `clientId` com o seu.

Sem `clientId` (histórico antigo), a identidade cai para o `peerId` e, por último, para o apelido — a regra completa está em `isOwnMessage` (`web/src/lib/chat.ts`).

## Grade de até 4 transmissões

Cada sala mostra **até 4 transmissões ao mesmo tempo**. O limite é rígido no cliente: o app guarda quem já foi solicitado (`requestedSharersRef`) e não pede um quinto stream ao servidor. Quando o limite é atingido, aparece o aviso **"Máximo de 4 transmissões simultâneas"** — na sidebar da sala e no palco.

A limitação é de **visualização**, não de quem compartilha:

- quem transmite não é interrompido — o 5º transmissor continua no servidor e **continua listado na sidebar**, marcado como *fora da grade*;
- dá para **abrir essa transmissão sozinha**, em tela cheia, pelo modo foco;
- o aviso não some ninguém da sala.

Com 4 outras pessoas transmitindo, o botão **Compartilhar Tela** fica bloqueado e um aviso acima dele diz que a grade está ocupada, até uma vaga abrir. O bloqueio é só no cliente: o servidor não recusa um quinto `start-sharing`.

O modo da grade acompanha quantas outras pessoas estão transmitindo (`gridModeForSharers`): 1 transmissão abre no modo 1, 2 no modo 2, e 3 ou 4 no modo 4. A primeira live que chega toca; as que chegam com outra já na tela vêm pausadas. Todas começam mudas.

Quem transmite vê o próprio preview (`LocalPreview`) na primeira célula da grade, e ele conta como uma vaga (`remoteSlotsForMode`). Sozinho, ele ocupa o palco no modo 1. Com 1 outra transmissão, a grade vai para o modo 2. Com 2 ou 3, vai para o modo 4. O preview não é arrastável. Ele usa o mesmo menu dos outros players (`StreamControls`), sem o botão de som, com estas opções:

- pausar o preview — ele entra pausado, com o texto "preview pausado" e o ícone da TV;
- zoom (ícone de lupa e um slider, no mesmo estilo do volume) e tela cheia;
- **Diagnóstico**: o mesmo painel de quem transmite;
- **Configurações**: abre a fonte, a resolução, a taxa de quadros e o aviso da captura. Um ponto âmbar no ícone avisa que existe um aviso da captura;
- **Parar transmissão**.

O menu fica no rodapé do preview, na mesma ordem dos outros players: o play fica entre o som e o zoom, dentro da ilha compacta. Não há faixa de "Sua transmissão" embaixo do vídeo.

Com uma live em foco (tela cheia), o preview some até voltar à grade.

Na grade (2 a 4 streams):

- **clicar num tile** (botão `open_in_full` no canto, ou `zoom_out_map` no rodapé) abre aquela transmissão em tela cheia; **"Voltar à grade"** (`arrow_back`) traz a grade de volta;
- o painel de diagnóstico abre só sobre a stream **em foco**; na grade ele fecha;
- cada tile tem **volume, mudo e zoom próprios** (de 100% a 200%) — um tile não mexe no som do outro;
- o **X** do tile **só oculta da grade localmente**: não derruba a transmissão de quem compartilha. O `Room` avisa o app (`onStreamRemoved`), o app para de receber aquela stream e **devolve o slot**, então outro stream pode ser pedido;
- no celular (abaixo de 640 px) a grade vira uma coluna empilhada em 16:9, com rolagem vertical.

Quem compartilha também pode trocar a resolução da live durante a transmissão — ver [`diagnostics.md`](diagnostics.md) para o que cada número de qualidade significa.

## Cancelar o seletor nativo de compartilhamento

Fechar o seletor "Escolher o que compartilhar" do navegador (Cancelar ou Esc) **não é erro de captura**: o Chrome rejeita o `getDisplayMedia` com `NotAllowedError` e nada é capturado nem transmitido. O app trata esse caso à parte e mostra o aviso **no próprio botão "Compartilhar Tela"**, que fica âmbar por alguns segundos com o texto "Cancelado — tente de novo"; a frase completa vai para leitores de tela (`role="status"`, `aria-live="polite"`):

> Compartilhamento cancelado. Nada foi transmitido — tente de novo quando quiser.

O aviso **some sozinho em 6 s** e desaparece na hora se a pessoa clicar de novo em "Compartilhar Tela" ou se a transmissão começar. As demais falhas de captura (hardware ocupado, permissão negada pelo sistema, navegador sem suporte) continuam com o tratamento de erro de sempre — ver `isScreenShareCancellation` em `web/src/lib/screenShare.ts`. Para conferir visualmente sem abrir o seletor real, use `http://localhost:3000/?mock&cancel`.

## Onde ficam as constantes

| Constante | Onde | Valor |
| --- | --- | --- |
| `MAX_SIMULTANEOUS_STREAMS` | `web/src/lib/constants.ts` | `4` |
| `ROOM_EMPTY_GRACE_MS` | `server/index.mjs` (env) | `30000` ms |
| `CHAT_MAX_LENGTH` | `server/index.mjs` | `500` |
| `CHAT_HISTORY_LIMIT` | `server/index.mjs` | `50` |
| `CHAT_RATE_LIMIT_MS` | `server/index.mjs` | `500` ms |
| `SESSION_TTL` | `web/src/lib/session.ts` | 12 h |
| `CLIENT_ID_KEY` | `web/src/lib/session.ts` | `telinha-client-id` |
| `RECONNECT_TIMEOUT_MS` | `web/src/App.tsx` | `6000` ms |

O limite de 4 transmissões é do cliente (`MAX_SIMULTANEOUS_STREAMS`): ele segura o número de streams *pedidos* por sala, e o servidor não impõe teto de transmissões.

O endereço do servidor de sinalização é outra variável, e essa é de build: `VITE_SIGNAL_HOST` (só o host, sem esquema e sem porta), lida em `web/src/lib/utils.ts` (`getSignalingHost` / `getSignalingUrl`). Sem ela, o app cai no fallback `${hostname}:4000`.
