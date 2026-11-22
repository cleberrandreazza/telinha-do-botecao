---
name: Telinha do Botecão
colors:
  background: '#0c0e13'
  surface: '#111318'
  surface-dim: '#111318'
  surface-bright: '#37393f'
  surface-tint: '#4edea3'
  surface-variant: '#33353a'
  surface-container-lowest: '#0c0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e2025'
  surface-container-high: '#282a2f'
  surface-container-highest: '#33353a'
  primary: '#4edea3'
  primary-container: '#10b981'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary: '#003824'
  on-primary-container: '#00422b'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  inverse-primary: '#006c49'
  secondary: '#4fdbc8'
  secondary-container: '#04b4a2'
  secondary-fixed: '#71f8e4'
  secondary-fixed-dim: '#4fdbc8'
  on-secondary: '#003731'
  on-secondary-container: '#003f38'
  on-secondary-fixed: '#00201c'
  on-secondary-fixed-variant: '#005048'
  tertiary: '#ffb95f'
  tertiary-container: '#e29100'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary: '#472a00'
  on-tertiary-container: '#523200'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  error: '#ffb4ab'
  error-container: '#93000a'
  on-error: '#690005'
  on-error-container: '#ffdad6'
  on-surface: '#e2e2e9'
  on-surface-variant: '#bbcabf'
  on-background: '#e2e2e9'
  inverse-surface: '#e2e2e9'
  inverse-on-surface: '#2e3036'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-base: '#0c0e13'
  surface-lowest: '#0a0c10'
  surface-card: '#141620'
  surface-card-hover: '#1a1d2b'
  surface-input: '#10121a'
  surface-border: '#1e2235'
  brand-emerald: '#10b981'
  brand-emerald-hover: '#059669'
  brand-emerald-dark: '#064e3b'
  brand-amber: '#f59e0b'
  brand-amber-hover: '#d97706'
typography:
  headline:
    fontFamily: 'Plus Jakarta Sans'
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 1.25
  body:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 1.5
  label:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 1.25
  mono:
    fontFamily: 'JetBrains Mono'
    fontSize: 10px
    fontWeight: '600'
rounded:
  DEFAULT: 0.25rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
  video-container: 1rem
spacing:
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  gutter: 0.75rem
  margin: 1rem
---

# Design System: Telinha do Botecão
**Projeto:** Telinha do Botecão — sala de transmissão P2P
**Base observada:** `web/src/index.css`, `web/tailwind.config.js`, `Room.tsx`, `StreamViewer.tsx` e `CrtEmptyState.tsx`.

## 1. Tema visual e atmosfera
A interface combina uma base escura e discreta de Material Design 3 com detalhes que lembram uma TV CRT de boteco: brilho verde esmeralda, ruído e scanlines sutis, animação de ligar/desligar e controles flutuantes translúcidos. O ambiente deve manter o vídeo como foco; o menu lateral retrátil e as ferramentas aparecem como camadas compactas sobre o canvas.

A sala é uma experiência de tela cheia (`h-screen`, `overflow-hidden`) com fundo `#0c0e13`, brilhos ambientais verde/teal e um canvas central. A estrutura real não contém placar, times, navegação de grade/histórico, perfis de convidados ou cartões de participantes destacados. O conteúdo de vídeo pertence ao stream conectado; quando ausente, a aplicação mostra o estado vazio com uma TV CRT ilustrada e ação para abrir o menu.

## 2. Paleta de cores e funções
Os valores abaixo vêm de `web/tailwind.config.js`; os tons legacy continuam presentes no tema para compatibilidade com a tela inicial e detalhes de CRT.

### Base e superfícies
- **Fundo noturno** `#0c0e13` (`background`, `surface-container-lowest`): fundo global e canvas.
- **Superfície carvão** `#111318` (`surface`, `surface-dim`): menu lateral e painéis escuros.
- **Superfície baixa** `#1a1b21` (`surface-container-low`): áreas internas do menu e perfil.
- **Superfície elevada** `#1e2025` (`surface-container`): botões e controles secundários.
- **Superfície elevada alta** `#282a2f` (`surface-container-high`): hover e controles ativos.
- **Superfície mais alta** `#33353a` (`surface-container-highest`, `surface-variant`): trilhos e elementos de apoio.
- **Superfície brilhante** `#37393f` (`surface-bright`): elevação máxima da escala MD3.
- **Superfície card legacy** `#141620`, hover `#1a1d2b`, input `#10121a`, base `#0c0e13`, lowest `#0a0c10`, borda legacy `#1e2235`.

### Acentos e interação
- **Verde primário** `#4edea3` (`primary`): ícones, foco, estados selecionados e atividade.
- **Verde esmeralda** `#10b981` (`primary-container`, `brand.emerald`): ações principais, LEDs e brilho CRT.
- **Verde claro** `#6ffbbe` (`primary-fixed`): destaque de texto/estado ativo.
- **Verde escuro** `#059669` (`brand.emerald-hover`), `#064e3b` (`brand.emerald-dark`), `#047857` e `#00422b` (`on-primary-container`): profundidade CRT, hover e contraste.
- **Teal secundário** `#4fdbc8` (`secondary`) e `#04b4a2` (`secondary-container`): acento secundário e variações de brilho.
- **Âmbar** `#ffb95f` (`tertiary`), `#e29100` (`tertiary-container`), `#ffddb8` (`tertiary-fixed`): alerta ou acento quente pontual; `#f59e0b` e `#d97706` são tokens legacy.

### Texto, contorno e estados
- **Texto principal** `#e2e2e9` (`on-surface`, `on-background`): títulos e conteúdo.
- **Texto secundário** `#bbcabf` (`on-surface-variant`): descrições e metadados.
- **Contorno** `#86948a` (`outline`) e **contorno sutil** `#3c4a42` (`outline-variant`): bordas e separadores.
- **Erro** `#ffb4ab` (`error`), container `#93000a` (`error-container`), texto sobre erro `#690005` e `#ffdad6`.
- Tons on-color do tema: `on-primary #003824`, `on-primary-fixed #002113`, `on-primary-fixed-variant #005236`, `inverse-primary #006c49`; `on-secondary #003731`, `on-secondary-container #003f38`, `on-secondary-fixed #00201c`, `on-secondary-fixed-variant #005048`; `on-tertiary #472a00`, `on-tertiary-container #523200`, `on-tertiary-fixed #2a1700`, `on-tertiary-fixed-variant #653e00`; `inverse-surface #e2e2e9` e `inverse-on-surface #2e3036`.

## 3. Tipografia
- **Geist** é a fonte geral do corpo e labels (`font-body`, `font-label-*`); **Plus Jakarta Sans** é usada em títulos (`font-headline-*`); **JetBrains Mono** é reservada para rótulos técnicos (`font-mono`). O CSS global declara a pilha `Geist, Plus Jakarta Sans, system-ui, -apple-system, sans-serif`.
- A escala observada nos componentes é compacta e baseada em classes explícitas: título de estado vazio 17px (`sm`: 19px), títulos/nome 12–15px, corpo de descrição 13px, rótulos de sala 11px, metadados 10px, micro-rótulo de energia 8px. Usam pesos 400–700 conforme a hierarquia e tracking mais apertado nos títulos.

## 4. Componentes e geometria
- **Botões:** controles compactos de 28–40px de altura, cantos de 8–12px (`rounded-lg`/`rounded-xl`), transições rápidas e estados de hover/foco visíveis. A ação principal do estado vazio usa `primary-container` com texto de contraste.
- **Menu lateral:** painel fixo de 290px, posicionado 12px das bordas superior, esquerda e inferior; fundo `#111318` com opacidade, blur, borda `#272a37`, raio de 16px, padding de 14px e sombra profunda. Recolhe por translação horizontal.
- **Player:** ocupa o canvas disponível, vídeo `object-contain`, fundo preto e cantos de 16px; `video-container` usa borda de 1px `#272a37`. Sobreposições e dock de controle ficam sobre o vídeo, com fundo preto translúcido, blur, contorno branco sutil e formato de cápsula.
- **Estado vazio CRT:** painel com raio de 16px (32px em `md`), borda `#272a37`, ruído verde, scanlines, reflexo e vinheta. A ilustração CRT é uma TV de moldura escura com antenas, botões/alto-falante laterais e LED verde; texto e botão de abrir menu ficam centralizados.
- **Bordas e elevação:** linhas finas e discretas separam painéis. Sombras são profundas nos painéis flutuantes; brilhos verdes suaves pontuam o player e estados ativos. As scanlines usam repetição de 4px.
- Ícones funcionais usam `Material Symbols Outlined`; a marca usa um pequeno ícone de TV em pixel art.

## 5. Layout e responsividade
- A sala usa uma coluna flex que ocupa a viewport inteira; o canvas principal centraliza `StreamViewer` ou `CrtEmptyState` e recebe padding de 10px, passando a 12px em `sm`.
- O menu é sobreposto e recolhível; fechado, há um botão de marca no canto superior esquerdo. Os controles do player flutuam próximos à borda inferior e somem após inatividade do mouse (3s), exceto quando o menu está sob interação.
- O estado vazio centraliza a TV e o texto num bloco de largura máxima de 448px (`max-w-md`) com espaçamento de 20px; a ação abre o menu lateral.
- Tailwind usa breakpoints padrão (`sm`, `md`, etc.), não redefinidos na configuração. Elementos da TV e do painel lateral crescem em `sm`; cantos do estado vazio aumentam em `md`.
- A escala espacial estendida inclui 4, 8, 12, 16 e 24px (`space-xs` a `space-xl`), gutter de 12px e margin de 16px.

## 6. Diretrizes de uso no Stitch
- Manter o vídeo como foco e reproduzir a estrutura real da sala: canvas central, marca/menu retrátil e dock de controles sobreposto.
- Preservar a paleta escura, o verde esmeralda funcional e a textura CRT de baixa intensidade; usar acentos âmbar somente quando justificados por estado.
- Não introduzir placar, times, jogadores, feed de eventos, convidados fictícios, cartões promocionais ou navegação fora do que existe nos componentes.
- O seletor de modo deve ser compacto e integrado ao dock do player, com duas opções claramente identificadas: “Jogo / Vídeo 60fps” e “Tela / Texto”. O selo “Áudio Estéreo Hi-Fi” deve ser pequeno, legível e integrado ao mesmo grupo de controles. São os únicos novos elementos solicitados.
- Usar `surface-container-*`, `primary`, `on-surface`, `on-surface-variant`, `outline-variant` e os demais tokens acima; manter foco de teclado perceptível e rótulos acessíveis.
