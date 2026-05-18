# Registrador de asistencia

Aplicacion local para que el docente cargue una lista de estudiantes desde Excel, configure dias y una ventana de tiempo de asistencia, y descargue reportes en Excel por dia o rango de fechas.

## Ejecutar

```powershell
npm install
npm start
```

Abra:

```text
http://localhost:3000
```

Credenciales iniciales del docente:

```text
Usuario: admin
Clave: admin123
```

Para cambiarlas:

```powershell
$env:ADMIN_USER="docente"
$env:ADMIN_PASSWORD="clave-segura"
npm start
```

## Flujo del docente

1. Entre en la pestana `Docente`.
2. Cree la materia una sola vez.
3. Seleccione los dias de clase, por ejemplo `L`, `M`, `Mi`.
4. Configure la ventana de asistencia, por ejemplo `14:10` a `14:20`.
5. Suba el Excel de estudiantes.
6. Comparta con los estudiantes el codigo o el enlace generado.
7. Descargue reportes Excel por un dia, varios dias o rango `desde/hasta`.
8. Cambie la clave en la seccion `Seguridad`.

## Flujo del estudiante

1. Entra al enlace o escribe el codigo de materia.
2. Busca su nombre, correo institucional o codigo.
3. Solo puede dar check si el dia y la hora estan dentro de la ventana configurada.
4. La app bloquea segundo registro del mismo estudiante, navegador/celular o IP para esa materia y fecha.

## Datos

En modo local, los registros se guardan en:

```text
data/asistencia.json
```

En produccion se recomienda Vercel + Supabase. Vercel publica la app y Supabase guarda los datos persistentes.

## Publicar en Vercel con Supabase

1. Cree un proyecto en Supabase.
2. Abra el SQL Editor y ejecute el archivo `supabase.sql`.
3. Suba este proyecto a GitHub.
4. Cree un proyecto en Vercel conectado al repositorio.
5. En Vercel, configure estas variables de entorno:

```text
SESSION_SECRET=un-texto-largo-y-secreto
ADMIN_USER=admin
ADMIN_PASSWORD=admin123
SUPABASE_URL=https://su-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=su-service-role-key
SUPABASE_STATE_KEY=asistencia-produccion
```

6. Despues del primer ingreso, cambie la clave desde `Docente > Seguridad`.
7. Comparta a los estudiantes el enlace `/estudiante/CODIGO-DE-MATERIA`.

Los reportes descargados tienen una sola hoja con:

- Nombre del estudiante
- Correo institucional
- Identificacion/Codigo
- Una columna por fecha programada en el rango seleccionado
- `SI` si registro asistencia, `NO` si no registro
