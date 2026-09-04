require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || 'bulk-uploads';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((o) => o.trim());

const MAX_FILES_PER_REQUEST = 60; // el cliente agrupa la carga en lotes de este tamano
const MAX_FILE_SIZE_MB = 15;

if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.warn(
    '[WARN] Faltan credenciales de Cloudinary. Copia .env.example a .env y complétalo antes de subir imágenes.'
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false, // se sirve un front-end propio simple; ajustar si se agregan CDNs externos
  })
);

app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limita abuso del endpoint de subida (ajustar segun necesidad real de trafico)
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de subida. Intenta de nuevo en unos minutos.' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_REQUEST,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uploadBufferToCloudinary(buffer, originalName) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: UPLOAD_FOLDER,
        resource_type: 'image',
        // usa el nombre original (sin extension) como pista, Cloudinary agrega un id unico igual
        filename_override: originalName,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Sube un lote de imagenes y devuelve sus links publicos
app.post('/api/upload', uploadLimiter, upload.array('images', MAX_FILES_PER_REQUEST), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No se recibió ninguna imagen en la solicitud.' });
  }

  const results = await Promise.allSettled(
    req.files.map((file) => uploadBufferToCloudinary(file.buffer, file.originalname))
  );

  const items = results.map((result, index) => {
    const originalName = req.files[index].originalname;
    if (result.status === 'fulfilled') {
      return {
        originalName,
        url: result.value.secure_url,
        publicId: result.value.public_id,
        bytes: result.value.bytes,
        format: result.value.format,
        width: result.value.width,
        height: result.value.height,
        success: true,
      };
    }
    return {
      originalName,
      success: false,
      error: result.reason?.message || 'Error desconocido al subir la imagen',
    };
  });

  res.json({ items });
});

// Genera un archivo Excel a partir de la lista de links que envia el cliente
app.post('/api/export-excel', (req, res) => {
  const { links } = req.body;

  if (!Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: 'No se recibió ninguna lista de links para exportar.' });
  }

  const rows = links.map((item, index) => ({
    '#': index + 1,
    'Nombre de archivo': item.originalName || '',
    Link: item.url || '',
    Formato: item.format || '',
    'Tamaño (KB)': item.bytes ? Math.round(item.bytes / 1024) : '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 5 },
    { wch: 35 },
    { wch: 70 },
    { wch: 10 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Links');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="links-imagenes.xlsx"');
  res.send(buffer);
});

// Manejo de errores de multer (archivo muy grande, demasiados archivos, tipo invalido)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
