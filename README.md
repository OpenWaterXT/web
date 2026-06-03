# Para Swimming Data Lab LIVE 2026

Esta versión permite lectura en directo mediante un proxy/API propio.

## Por qué hace falta proxy
Un HTML abierto como archivo local no puede saltarse CORS, X-Frame-Options, CSP o bloqueos anti-bot de una web externa. El navegador protege al usuario y bloquea la extracción directa. Por eso el HTML llama a `/api/wps-ranking`, que se ejecuta en servidor y devuelve JSON al propio HTML.

## Despliegue rápido en Vercel
1. Sube esta carpeta a GitHub.
2. Entra en Vercel y crea un proyecto desde el repositorio.
3. Deploy.
4. Abre la URL de Vercel.
5. En la pestaña "Ranking en vivo", pulsa "Leer ranking en directo" o "Auto-detectar API".

## Nota
Si IPC Services cambia su estructura interna o activa verificación anti-bot fuerte, el proxy puede recibir HTML sin tabla o status 403. En ese caso habrá que ajustar el extractor o usar un servicio de navegador/headless autorizado.
