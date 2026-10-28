# pi-cpamc

Puente dinámico de proveedores de [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (cpamc) para **Pi**.

Registra dinámicamente un proveedor por cada cuenta activa de cpamc en Pi (`cpamc/<cuenta>`), agrupando en `/model` únicamente los modelos que esa cuenta sirve realmente.

## Características

- **Cero cuentas ni modelos hardcodeados**: Consulta en tiempo real las credenciales y modelos disponibles vía la API de cpamc (`/v8/management/credentials`).
- **Cero secretos en el repositorio**: Las credenciales no se escriben en el código ni se commitean. Se leen de variables de entorno o se auto-descubren de los archivos locales `.mgmtkey` y `.apikey`.
- **Catálogo en vivo**: Soporta `refreshModels` para que cada vez que consultes `/model` en Pi se refresquen los modelos sin necesidad de reiniciar la sesión.
- **Sincronización en segundo plano**: Un temporizador cada 60s detecta cuentas agregadas o removidas en cpamc sin interrumpir la sesión de Pi.

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

> **Tip (dentro del TUI / chat interactivo):**  
> Tanto en Pi como en Gentle Shell podés escribir directamente el comando interactivo:  
> `/install git:github.com/Deury08/pi-cpamc` (o `/install .` si estás en el repo local).

## Configuración

La extensión funciona tanto en local como conectada a un **servidor remoto o VPS**. El orden de resolución es:

1. **Variables de entorno** (máxima prioridad)
2. **Archivo de configuración persistente** (`~/.pi/agent/cpamc.json`, configurable con el comando `/cpamc`)
3. **Auto-descubrimiento local** (archivos `.mgmtkey` y `.apikey` en `Documents/CLIProxyAPI/` o `~/.cli-proxy-api/`)
4. **Default local**: `http://127.0.0.1:8317`

### Opción A: Desde el chat interactivo (TUI) con `/cpamc`

Si tenés cpamc corriendo en otra PC o VPS, podés configurarlo en vivo desde Pi o Gentle Shell:

```text
# Configurar la URL de tu VPS o servidor remoto:
/cpamc url http://tu-vps-o-ip:8317

# Configurar las llaves si el servidor está en otra máquina:
/cpamc keys mgmt-tu-management-key sk-tu-client-api-key

# Ver el estado actual y cuentas activas:
/cpamc status

# Forzar una re-sincronización manual:
/cpamc resync
```

### Opción B: Mediante archivo de configuración (`cpamc.json`)

Podés crear o editar directamente `~/.pi/agent/cpamc.json`:

```json
{
  "baseUrl": "http://tu-vps:8317",
  "managementKey": "mgmt-...",
  "apiKey": "sk-..."
}
```

### Opción C: Variables de entorno (ideal para Docker / CI / VPS)

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `CPAMC_BASE_URL` | URL base del servidor CLIProxyAPI | `http://127.0.0.1:8317` |
| `CPAMC_MANAGEMENT_KEY` | Clave de gestión (`mgmt-...`) | Auto-descubierta de `.mgmtkey` |
| `CPAMC_API_KEY` | Clave cliente para inferencia (`sk-...`) | Auto-descubierta de `.apikey` |

## Verificación

Para probar la conectividad y ver las cuentas detectadas en vivo:

```bash
node test/smoke.mjs
```

## Licencia

MIT
