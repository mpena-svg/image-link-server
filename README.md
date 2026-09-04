# Imágenes → links (subida masiva)

Servidor que permite subir imágenes de forma masiva (por lotes), obtener un link público
para cada una y exportar todos los links a un archivo Excel.

## ¿Cómo funciona?

- **Almacenamiento**: las imágenes se suben a **Cloudinary** (plan gratuito), que las
  guarda y las sirve por CDN con una URL pública estable. Se eligió Cloudinary en vez de
  almacenamiento local porque el servidor va a estar desplegado en internet: con disco
  local perderías las imágenes en cada redeploy y no escalaría bien; con S3 tendrías que
  configurar buckets, políticas IAM y un dominio para servir los archivos. Cloudinary te
  da URL pública + CDN + panel de control en 5 minutos, con una capa gratuita generosa.
- **Backend**: Node.js + Express. Recibe las imágenes por lotes (`multer`), las sube a
  Cloudinary, y expone un endpoint que arma el Excel al vuelo (`xlsx`) sin guardar nada
  en una base de datos.
- **Frontend**: una sola página HTML/JS sin frameworks, para no añadir complejidad
  innecesaria. Soporta arrastrar y soltar, sube en lotes de 15 imágenes para no saturar
  la conexión, muestra una barra de progreso y arma una tabla con miniaturas y links.

## 1. Configurar Cloudinary

1. Crea una cuenta gratis en https://cloudinary.com
2. En el Dashboard copia: **Cloud name**, **API Key** y **API Secret**.
3. Copia `.env.example` a `.env` y pega esos tres valores:

```bash
cp .env.example .env
```

## 2. Instalar y correr en local

```bash
npm install
npm start
```

Abre http://localhost:3000

## 3. Desplegar en internet

Cualquier servicio que corra Node.js sirve. Los más simples para este tipo de proyecto:

### Opción A — Render.com (recomendado, tiene capa gratuita)
1. Sube este proyecto a un repositorio de GitHub.
2. En Render: **New → Web Service** → conecta el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. En **Environment**, agrega las mismas variables de tu `.env`
   (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `UPLOAD_FOLDER`).
5. Deploy. Render te da una URL pública tipo `https://tu-app.onrender.com`.

### Opción B — Railway.app
Mismo flujo: conectar repo, configurar variables de entorno, deploy automático.

### Opción C — Un VPS propio (DigitalOcean, EC2, etc.)
```bash
git clone <tu-repo>
cd image-link-server
npm install
# configura .env
npm install -g pm2
pm2 start server.js --name imagenes-links
```
Pon un proxy (nginx) delante para HTTPS con Let's Encrypt.

## Configuración relevante (`.env`)

| Variable | Descripción |
|---|---|
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Credenciales de tu cuenta Cloudinary |
| `UPLOAD_FOLDER` | Carpeta dentro de Cloudinary donde se organizan las imágenes subidas |
| `PORT` | Puerto del servidor (por defecto 3000) |
| `ALLOWED_ORIGINS` | Dominios permitidos para CORS, separados por coma. `*` permite cualquiera |

## Límites configurados

- Tamaño máximo por imagen: **15 MB** (`MAX_FILE_SIZE_MB` en `server.js`)
- Imágenes por request al backend: **60** (`MAX_FILES_PER_REQUEST` en `server.js`)
- El frontend agrupa la subida en lotes de **15** imágenes por request
  (`BATCH_SIZE` en `public/app.js`), así que en la práctica puedes soltar 500 imágenes
  de una vez en la pantalla y se van subiendo lote por lote con progreso visible.
- Límite de tasa: 300 subidas cada 15 minutos por IP (`express-rate-limit`), ajustable en
  `server.js` si tu volumen real es mayor.

## Ajustar si tu volumen crece

- Si vas a subir miles de imágenes por lote regularmente, considera:
  - Subir el `BATCH_SIZE` del frontend y `MAX_FILES_PER_REQUEST` del backend con cuidado
    (ojo con timeouts del hosting gratuito).
  - Agregar autenticación (ej. una clave simple en un header) si el servidor va a quedar
    público, para que no cualquiera pueda usar tu cuota de Cloudinary.
  - Guardar el historial de subidas en una base de datos si necesitas consultarlo después
    (hoy el Excel se arma solo con lo que hay en pantalla en el momento).

## Endpoints

- `GET /api/health` — chequeo de salud
- `POST /api/upload` — recibe `multipart/form-data` con campo `images` (uno o varios
  archivos), devuelve `{ items: [{ originalName, url, publicId, bytes, format, success }] }`
- `POST /api/export-excel` — recibe `{ links: [...] }` (mismo formato que arriba) y
  devuelve el archivo `links-imagenes.xlsx` para descargar
