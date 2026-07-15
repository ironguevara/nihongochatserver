# Nihongo Chat Server — Gemini com Fallback Automático

Esta versão mantém o mesmo endpoint do aplicativo:

```text
https://nihongochatserver.vercel.app/api/chat
```

## Proteções adicionadas

O servidor tenta automaticamente, nesta ordem:

1. `gemini-3.1-flash-lite`
2. `gemini-3.5-flash`
3. `gemini-flash-latest`

Quando um modelo responde com alta demanda, timeout, erro 429 ou erro temporário 5xx, o backend aguarda brevemente e tenta o próximo.

Cada tentativa possui timeout interno. O orçamento total foi limitado para que a função responda antes do timeout de 30 segundos da Vercel.

## Variáveis na Vercel

Mantenha:

```text
GEMINI_API_KEY = sua chave
ALLOWED_ORIGIN = *
```

Substitua `GEMINI_MODEL` por:

```text
GEMINI_MODELS = gemini-3.1-flash-lite,gemini-3.5-flash,gemini-flash-latest
```

A ordem da lista é a ordem de preferência.

Também é possível deixar `GEMINI_MODELS` ausente. O código utilizará essa mesma sequência como padrão.

## Atualização

1. Substitua no GitHub os arquivos antigos pelo conteúdo desta pasta.
2. Faça commit.
3. Atualize as variáveis de ambiente na Vercel.
4. Aguarde o novo deployment ficar `Ready`.
5. Teste pelo aplicativo.

## Diagnóstico

Uma resposta bem-sucedida inclui o cabeçalho:

```text
X-Gemini-Model
```

Ele informa qual modelo respondeu.

Se todos estiverem temporariamente indisponíveis, a API retorna status 503 e uma mensagem amigável, em vez de aguardar até a Vercel encerrar a função.

## Observação sobre nível gratuito

Disponibilidade e quotas gratuitas variam por modelo, projeto e região. Consulte o painel **Google AI Studio → Dashboard → Rate Limits** para ver os limites efetivos da sua chave.
