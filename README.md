# pi-cpamc

Puente dinámico de proveedores de [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (cpamc) para **Pi**.

Registra dinámicamente un proveedor por cada cuenta activa de cpamc en Pi (`cpamc/<cuenta>`), agrupando en `/model` únicamente los modelos que esa cuenta sirve realmente.

## Características

- **Cero cuentas ni modelos hardcodeados**: Consulta en tiempo real las credenciales y modelos disponibles vía la API de cpamc (`/v8/management/credentials`).
- **Cero secretos en el repositorio**: Las credenciales no se escriben en el código ni se commitean. Se leen de variables de entorno o se auto-descubren de los archivos locales `.mgmtkey` y `.apikey`.
- **Catálogo en vivo**: Soporta `refreshModels` para que cada vez que consultes `/model` en Pi se refresquen los modelos sin necesidad de reiniciar la sesión.
- **Sincronización en segundo plano**: Un temporizador cada 60s detecta cuentas agregadas o removidas en cpamc sin interrumpir la sesión de Pi.

## Instalación

En Pi:

```bash
pi install C:/Users/Polanco/pi-cpamc
```

O si está publicado en un repositorio Git:

```bash
pi install git:github.com/tu-usuario/pi-cpamc
```

## Configuración

Por defecto, la extensión busca automáticamente los archivos `.mgmtkey` y `.apikey` generados por CLIProxyAPI en sus rutas estándar (`Documents/CLIProxyAPI/`, `~/.cli-proxy-api/`, etc.).

Si querés forzar valores específicos o correrlo en otra máquina/puerto, podés configurar las variables de entorno:

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
