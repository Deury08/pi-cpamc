# pi-cpamc 🚀

Conector dinámico de **CLIProxyAPI (cpamc)** para **Pi** y **Gentle Shell**.

Permite que tu terminal de Pi o Gentle Shell detecte automáticamente todos los modelos y cuentas que tenés configurados en tu proxy de IA, para que puedas seleccionarlos directamente desde el comando `/model`.

---

## 💡 ¿Qué problema resuelve?

Si usás [CLIProxyAPI (cpamc)](https://github.com/router-for-me/CLIProxyAPI) para centralizar tus proveedores de IA (Claude, Gemini, GPT, etc.), normalmente tendrías que registrar cada modelo y cada API key a mano dentro de la configuración de Pi.

Con **pi-cpamc**:
1. La extensión se comunica con la API de tu proxy (`GET /v1/models`).
2. Descubre en tiempo real qué modelos tenés disponibles.
3. Los registra en el menú `/model` automáticamente, listos para usar con un clic.

Funciona de manera idéntica sin importar dónde corre tu proxy: en tu propia máquina (Windows, Mac o Linux), en un contenedor Docker, en WSL o en un servidor remoto (VPS).

---

## 📋 Requisitos previos

Antes de conectar la extensión, asegurate de tener:
1. **CLIProxyAPI en funcionamiento**: El servidor del proxy debe estar corriendo (por defecto en `http://127.0.0.1:8317`).
2. **Tu API Key de cliente**: La clave que empieza con `sk-...` que definiste en la configuración de tu proxy para autorizar llamadas.

---

## ⚡ Guía de inicio rápido (3 pasos)

### Paso 1: Instalar la extensión

Ejecutá en tu terminal según la herramienta que uses:

**Si usás Pi:**
```bash
pi install git:github.com/Deury08/pi-cpamc
```

**Si usás Gentle Shell:**
```bash
gentle-shell install git:github.com/Deury08/pi-cpamc
```

*(Si descargaste o clonaste el repositorio en tu máquina, podés instalarlo con `pi install .` desde dentro de la carpeta).*

---

### Paso 2: Conectar con tu servidor (`/cpamc connect`)

Abrí tu sesión de Pi o Gentle Shell y escribí en la barra de mensajes:

```text
/cpamc connect
```

Se abrirá un asistente paso a paso en tu pantalla:
1. **URL del servidor**: Presioná `Enter` para usar el valor por defecto (`http://127.0.0.1:8317`), o escribí la dirección donde corre tu proxy (ejemplo si corre en Docker o VPS: `http://192.168.1.10:8317`).
2. **Comprobación**: El asistente verifica automáticamente si el servidor responde.
3. **API Key**: Pegá tu clave de cliente (`sk-...`).

Al confirmar, la extensión consulta los modelos disponibles y guarda tu configuración de forma segura en `~/.pi/agent/cpamc.json`.

---

### Paso 3: Elegir un modelo y empezar a programar

Escribí en el chat:

```text
/model
```

Verás agrupados todos los modelos que te provee cpamc (por ejemplo: `claude-sonnet-4-6`, `gemini-3-flash`, etc.). Seleccionás el que quieras y empezás a trabajar normalmente.

---

## 🛠️ Comandos útiles dentro del chat

Podés usar estos comandos en cualquier momento mientras conversás con el agente:

| Comando | ¿Para qué sirve? |
|---|---|
| `/cpamc connect` | Abre el asistente interactivo para cambiar la URL o la API Key. |
| `/cpamc connect <URL> <API_KEY>` | Conexión rápida en una sola línea (útil para no pasar por el asistente). |
| `/cpamc status` (o solo `/cpamc`) | Muestra si la conexión con el proxy está activa y cuántos modelos hay listados. |
| `/cpamc resync` | Vuelve a consultar el proxy en ese instante (ideal si agregaste cuentas nuevas a tu proxy y querés verlas ya). |
| `/cpamc help` | Muestra la ayuda de subcomandos disponibles. |

---

## ❓ Preguntas frecuentes y solución de problemas

### ¿Qué pasa si el proxy de cpamc está apagado o se reinicia?
La extensión está diseñada para **no interferir en tu trabajo**. Si el proxy no responde, la extensión falla en silencio en segundo plano: no bloquea el arranque de Pi ni ensucia la pantalla con advertencias. Cuando vuelvas a encender tu proxy, el catálogo se sincronizará automáticamente.

### ¿Cómo lo uso si cpamc corre en Docker o en otra PC/VPS?
Solo tenés que ejecutar `/cpamc connect` y poner la dirección IP o dominio accesible desde tu máquina, por ejemplo:
- Docker local: `http://localhost:8317` o el puerto que hayas mapeado.
- Otra PC en tu red local: `http://192.168.1.50:8317`
- Servidor remoto: `https://tu-servidor.com:8317`

### ¿Puedo configurar la conexión con variables de entorno?
Sí, si preferís no usar el archivo de configuración local o querés automatizarlo en scripts:

- `CPAMC_BASE_URL`: URL base de tu proxy (ejemplo: `http://127.0.0.1:8317`).
- `CPAMC_API_KEY`: Tu clave de cliente (`sk-...`).

---

## 🧪 Comprobar la conexión desde la terminal

Si querés verificar que tu proxy responde correctamente antes de abrir Pi:

```bash
node test/smoke.mjs
```

Este script realiza un test rápido: hace un ping al servidor, lista los modelos activos y confirma que la comunicación API funcione sin problemas.

---

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
