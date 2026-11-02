# Mi Balance 2.0 — Hogar y Proyectos (compartido)

Versión web instalable para **dos o más personas con cuentas propias**, información guardada en Supabase/PostgreSQL y actualizaciones entre dispositivos. El enlace público da acceso únicamente a la **pantalla de autenticación**; los registros financieros están protegidos por reglas RLS en la base de datos.

## Lo nuevo frente a la versión 1.0

- Hogar único: usuarios independientes que comparten tarjetas, presupuestos, proyectos y movimientos.
- Registros separados en la base de datos. Dos movimientos nuevos de teléfonos distintos **no pisan** uno al otro.
- Notificaciones en tiempo real para refrescar datos de la interfaz.
- Identificación del usuario que creó un movimiento.
- Guardado remoto y cola local de operaciones pendientes en caso de interrupción, con indicador visible de sincronización; se recomienda **conexión a internet** para uso normal.
- Historial de todos los meses, sin necesidad de crear un archivo por mes.
- Invitación de un solo uso, con vencimiento a 7 días.
- Proyección de caja a 30/60/90 días, con escenario prudente y con cobros estimados a clientes, compromisos futuros y alertas.
- Importación de respaldos JSON de la versión anterior **solamente en un hogar nuevo**, para evitar registros duplicados.

## ARCHIVOS QUE CONTIENE EL ZIP

- `index.html`: interfaz web.
- `cloud.js`: sincronización y autenticación.
- `config.js`: URL y **clave pública** de Supabase (al principio vacía).
- `database.sql`: crea las tablas, funciones privadas y políticas de acceso.
- `sw.js`, `manifest.webmanifest`, `icon-192.png` e `icon-512.png`: instalación como aplicación PWA.

## 1 — Crear la base de datos en Supabase

1. Entra en **https://supabase.com** y crea una cuenta.
2. Selecciona **New project**. Asigna nombre, región y una contraseña fuerte para la base de datos. **No envíes ni publiques esta contraseña**.
3. En el panel del proyecto abre **SQL Editor** → **New query**.
4. Copia TODO el contenido de `database.sql` y pulsa **Run**. Debe completarse sin errores. Esto crea las reglas que impiden acceder a datos de otros hogares.
5. En **Authentication → Providers → Email**, habilita correo/contraseña; se recomienda conservar activada la confirmación por correo.
6. En **Project Settings / Connect → API Keys**, identifica la **Project URL** `https://...supabase.co` y la clave **publishable** `sb_publishable_...` (o, si tu panel solo ofrece ese formato, la `anon` pública).

**Atención:** la clave `service_role`, una clave `secret`, el password de Supabase y las contraseñas personales **NUNCA** se colocan en `config.js`.

## 2 — Vincular la aplicación a Supabase

Abre `config.js` y completa solo los campos públicos:

```javascript
window.MI_BALANCE_CONFIG = {
  url: 'https://TU-PROYECTO.supabase.co',
  key: 'sb_publishable_TU_CLAVE_PUBLICA'
};
```

El navegador necesita conexión a internet para cargar la biblioteca oficial de Supabase y sincronizarse.

Alternativa: si `config.js` está vacío, cada persona podrá introducir los dos campos públicos desde la pantalla inicial. Es más cómodo configurarlos en el archivo una sola vez para el enlace compartido.

## 3 — Publicar un solo enlace gratuito en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `mi-balance-compartido`.
2. Sube al directorio raíz estos archivos: `index.html`, `cloud.js`, `config.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`. **No subas respaldos JSON con tus finanzas.** `database.sql` no hace falta publicarlo.
3. En el repositorio abre **Settings → Pages**; selecciona **Deploy from a branch**, rama `main`, carpeta `/(root)` y guarda.
4. La URL será similar a: `https://TU-USUARIO.github.io/mi-balance-compartido/`. Si no carga enseguida, consulta el estado del despliegue en GitHub.
5. En Supabase abre **Authentication → URL Configuration** y coloca la URL publicada como **Site URL** y/o dirección permitida en **Redirect URLs** (de acuerdo con la configuración del proyecto). Esto permite confirmar los correos desde la aplicación.

El código HTML puede estar en un repositorio público sin exponer los datos: la base PostgreSQL requiere usuario autenticado y comprueba el acceso al hogar. **La privacidad depende de conservar activadas las políticas RLS proporcionadas en `database.sql`.**

## 4 — Configurar los dos teléfonos

1. En tu teléfono abre el enlace HTTPS, regístrate con tu correo y una contraseña distinta y segura; confirma el correo si Supabase lo solicita.
2. Inicia sesión y selecciona **Crear hogar compartido**. Elige, por ejemplo, `Hogar familiar`.
3. En **Ajustes → Acceso familiar y respaldo** pulsa **Generar invitación para mi esposa/o**.
4. Comparte ese código por un canal privado. Es de un solo uso y dura 7 días.
5. Tu esposa abre **el mismo enlace**, crea **su propia cuenta** y selecciona **Unirme al mismo hogar** pegando el código.
6. Ahora ambos ven los mismos datos y pueden trabajar desde sus teléfonos. En Chrome Android, menú (⋮) → **Instalar aplicación** o **Agregar a pantalla principal**.

No compartan la misma contraseña, ni la clave de acceso al panel de Supabase.

## 5 — Valores iniciales y registro

1. **Ajustes**: registra el sueldo familiar de referencia (solo para presupuesto), ahorro objetivo, saldos de efectivo/banco y ahorros, y día usual de cobro del sueldo (solo para proyección).
2. **Presupuestos**: asigna límites en alimentación, electricidad, agua, internet, medicina y otras categorías.
3. **Tarjetas**: crea cada tarjeta con su deuda inicial y sus días de corte/pago.
4. **Proyectos**: registra cada trabajo, cuánto esperas cobrar y fecha aproximada.
5. **Registrar**: agrega gastos reales de hogar, compras de proyectos con tarjeta, cobros, pagos de tarjeta y transferencias de utilidad.
6. **Flujo 90 días**: consulta el saldo estimado sin depender de cobros pendientes y una segunda estimación suponiendo que los clientes pagan en las fechas previstas. Añade compromisos para pagos futuros.

Ejemplo: compra de materiales por USD 800 con tarjeta como *Compra / costo de proyecto*. **No** se contabiliza como gasto familiar. Registra el pago a la tarjeta cuando efectivamente lo hagas. Si cobras USD 1200 del cliente y transfieres USD 400 de utilidad al hogar, solo esos USD 400 pasan al ingreso familiar.

## 6 — Migrar la versión anterior y respaldar

Si ya registraste movimientos en v1:

- En la v1 abre **Ajustes → Descargar respaldo JSON**.
- En v2, al haber creado un hogar **sin movimientos**, ve a **Ajustes → Importar respaldo (hogar nuevo)**, y selecciona el JSON.
- No importes el mismo respaldo dos veces. No se permite importar en hogares con movimientos para evitar duplicados.
- Si usaste la versión anterior en el **mismo navegador y dominio**, también puede funcionar **Importar datos de versión anterior**.
- Una vez sincronizado, ambos verán ese historial.

Se recomienda exportar un respaldo JSON mensual y guardarlo fuera del dispositivo. Los planes gratuitos de Supabase no incluyen el respaldo diario administrado del plan Pro.

## 7 — Límites y precauciones

- **Esta entrega es código funcional listo para configurar, NO un enlace ya publicado.** Primero hay que crear tu proyecto Supabase y publicar en tu cuenta de GitHub. No se pueden proporcionar una URL ni credenciales reales sin ese paso.
- Aunque dos movimientos distintos no se pisan, si dos usuarios editan exactamente **el mismo movimiento a la vez**, prevalecerá el último guardado. A futuro conviene añadir un mecanismo de control de versiones si ese caso resulta frecuente.
- No hay conciliación bancaria ni conexión real a bancos o tarjetas. Los saldos dependen de registros completos.
- La proyección no representa efectivo garantizado: los cobros futuros pueden retrasarse. Se distribuye el presupuesto mensualmente como egreso diario de caja; la deuda actual de tarjeta se supone pagada íntegra en el próximo vencimiento configurado. Es un escenario conservador, no el calendario exacto del banco.
- Una operación con error de internet queda en la cola local de ese navegador; comprueba el estado **Sincronizado**, especialmente antes de cerrar la aplicación o limpiar datos del navegador.
- El plan gratuito de Supabase puede pausar el proyecto después de **7 días sin actividad**; se puede reactivar en el panel. Consulta las condiciones vigentes de los proveedores.
- Recomendación: mantener el proyecto Supabase, contraseña de administrador y control de GitHub bajo tu propia cuenta; la aplicación funciona para tu familia aunque no uses servicios de terceros adicionales.

### Verificación técnica realizada

Se revisó la sintaxis JavaScript de la interfaz y la sincronización, y se probaron automáticamente los cálculos contables y la transformación de registros a y desde el modelo de almacenamiento. **No se ha probado contra una cuenta real de Supabase ni con dos teléfonos físicos**, ya que faltan las credenciales y la publicación.
