# pi-cpamc

Puente dinámico de proveedores de [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (cpamc) para **Pi** y **Gentle Shell**.

Conecta Pi directamente a la API HTTP de cpamc para descubrir en tiempo real todos los modelos disponibles en tu servidor, sin importar si corre localmente, en Docker, en Linux, en WSL o en un VPS remoto.

## Características

- **100% basado en API (Agnóstico del Sistema)**: Cero lectura de archivos en disco. Funciona de forma transparente si cpamc corre en Docker, WSL, Linux o VPS.
- **Cero modelos hardcodeados**: Descubre dinámicamente cualquier modelo disponible consultando `GET /v1/models`. Si agregás o quitás cuentas/modelos en cpamc, se reflejan automáticamente.
- **Asistente interactivo `/connect`**: Al estilo OpenCode, configurás la URL y la API key en un diálogo paso a paso dentro del TUI.
- **Catálogo en vivo**: Soporta `refreshModels` para que cada vez que abras `/model` se consulte la lista actualizada de modelos en caliente.

## Instalación

Elegí la variante según el entorno que estés usando:

### Variante 1: Pi (CLI estándar)

**Instalación directa desde GitHub (recomendada):**
```bash
pi install git:github.com/Deury08/pi-cpamc
```

**O si clonaste el repositorio localmente:**
```bash
# Estando dentro de la carpeta del repo clonado:
pi install .

# O pasando la ruta relativa/absoluta:
pi install ./pi-cpamc
```

**Verificar instalación:**
```bash
pi list
pi --list-models
```

---

### Variante 2: Gentle Shell

**Instalación directa desde GitHub (recomendada):**
```bash
gentle-shell install git:github.com/Deury08/pi-cpamc
```

**O si clonaste el repositorio localmente:**
```bash
# Estando dentro de la carpeta del repo clonado:
gentle-shell install .

# O pasando la ruta relativa/absoluta:
gentle-shell install ./pi-cpamc
```

**Verificar instalación:**
```bash
gentle-shell list
```

---

## Configuración con `/connect` (Recomendado)

Una vez instalada la extensión, abrís Pi o Gentle Shell y escribís:

```text
/connect
```

El asistente te guiará paso a paso:
1. **URL de cpamc**: Presioná Enter para usar el default (`http://127.0.0.1:8317`) o ingresá la URL de tu contenedor Docker / VPS (ej. `http://localhost:9000` o `https://mi-vps.com:8317`).
2. **Health check**: Verifica automáticamente la salud del servidor (`GET /`).
3. **API Key**: Pegás tu clave de cliente (`sk-...`).
4. **Validación y conexión**: Consulta `GET /v1/models`, registra el proveedor `cpamc` con todos los modelos disponibles y guarda la configuración en `~/.pi/agent/cpamc.json`.

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `/connect` | Abre el asistente interactivo para conectar URL y API Key |
| `/connect <url> <apiKey>` | Conexión directa en una sola línea (ideal para scripts) |
| `/cpamc status` | Muestra la URL actual y estado de la conexión |
| `/cpamc resync` | Fuerza la re-sincronización inmediata de modelos con cpamc |

---

## Configuración alternativa (Variables de entorno)

Ideal para entornos automatizados, Docker o CI/CD:

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `CPAMC_BASE_URL` | URL base del servidor CLIProxyAPI | `http://127.0.0.1:8317` |
| `CPAMC_API_KEY` | Clave cliente para inferencia y modelos (`sk-...`) | Leída de `cpamc.json` |

---

## Verificación

Para probar la conexión y listar los modelos disponibles en tu terminal:

```bash
node test/smoke.mjs
```

## Licencia

MIT
