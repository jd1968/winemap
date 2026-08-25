const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const projectRoot = path.resolve(__dirname, '..');
const uploadsRoot = path.join(projectRoot, 'uploads');
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseStorageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'wine-atlas-media').trim();

let supabaseClient = null;
let ensureBucketPromise = null;

function createSafeFilenameBase(value, fallback = 'image') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || fallback;
}

function getMimeTypeForExtension(extension) {
  switch (String(extension || '').toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

function getExtensionForMimeType(contentType) {
  switch (String(contentType || '').toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/heic':
      return '.heic';
    case 'image/heif':
      return '.heif';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.jpg';
  }
}

function getContentTypeFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    return getMimeTypeForExtension(path.extname(pathname));
  } catch (error) {
    return 'image/jpeg';
  }
}

function isSupabaseStorageConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function getSupabaseClient() {
  if (!isSupabaseStorageConfigured()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabaseClient;
}

async function ensureSupabaseBucket() {
  const client = getSupabaseClient();

  if (!client) {
    return false;
  }

  if (!ensureBucketPromise) {
    ensureBucketPromise = (async () => {
      const bucketOptions = {
        public: true,
        allowedMimeTypes: ['image/*'],
        fileSizeLimit: '10MB'
      };

      const { error: createError } = await client.storage.createBucket(
        supabaseStorageBucket,
        bucketOptions
      );

      if (
        createError &&
        !/exists|duplicate|already/i.test(String(createError.message || ''))
      ) {
        throw createError;
      }

      const { error: updateError } = await client.storage.updateBucket(
        supabaseStorageBucket,
        bucketOptions
      );

      if (
        updateError &&
        !/not found/i.test(String(updateError.message || ''))
      ) {
        throw updateError;
      }

      return true;
    })().catch((error) => {
      ensureBucketPromise = null;
      throw error;
    });
  }

  return ensureBucketPromise;
}

function buildRelativeUploadUrl(folder, filename) {
  return `/uploads/${folder}/${filename}`;
}

function buildLocalUploadFilePath(uploadUrl) {
  const value = String(uploadUrl || '').trim();

  if (!value.startsWith('/uploads/')) {
    return null;
  }

  return path.join(projectRoot, value.replace(/^\/+/, ''));
}

function buildStoragePath(folder, originalName, contentType, fallbackBase = 'image') {
  const extension = path.extname(originalName || '') || getExtensionForMimeType(contentType);
  const safeBase = createSafeFilenameBase(
    path.basename(originalName || fallbackBase, path.extname(originalName || '')),
    fallbackBase
  );

  return `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeBase}${extension}`;
}

async function storeImageBuffer({
  buffer,
  folder,
  originalName,
  contentType,
  fallbackBase = 'image'
}) {
  const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (isSupabaseStorageConfigured()) {
    const client = getSupabaseClient();
    await ensureSupabaseBucket();
    const storagePath = buildStoragePath(folder, originalName, contentType, fallbackBase);
    const { error: uploadError } = await client.storage
      .from(supabaseStorageBucket)
      .upload(storagePath, fileBuffer, {
        contentType: contentType || getMimeTypeForExtension(path.extname(originalName || '')),
        upsert: false,
        cacheControl: '3600'
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = client.storage
      .from(supabaseStorageBucket)
      .getPublicUrl(storagePath);

    return {
      url: data?.publicUrl || '',
      path: storagePath,
      storage: 'supabase'
    };
  }

  const extension = path.extname(originalName || '') || getExtensionForMimeType(contentType);
  const safeBase = createSafeFilenameBase(
    path.basename(originalName || fallbackBase, path.extname(originalName || '')),
    fallbackBase
  );
  const filename = `${Date.now()}-${safeBase}${extension}`;
  const destinationDir = path.join(uploadsRoot, folder);
  await fs.promises.mkdir(destinationDir, { recursive: true });
  await fs.promises.writeFile(path.join(destinationDir, filename), fileBuffer);

  return {
    url: buildRelativeUploadUrl(folder, filename),
    path: filename,
    storage: 'local'
  };
}

async function readImageAsset(imageUrl) {
  const value = String(imageUrl || '').trim();

  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);

    if (!response.ok) {
      throw new Error(`Could not fetch image asset: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || getContentTypeFromUrl(value);
    let fileName = 'image';

    try {
      fileName = path.basename(new URL(value).pathname) || 'image';
    } catch (error) {
      fileName = 'image';
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: contentType,
      fileName
    };
  }

  const localFilePath = buildLocalUploadFilePath(value);

  if (!localFilePath) {
    return null;
  }

  return {
    buffer: await fs.promises.readFile(localFilePath),
    mimeType: getMimeTypeForExtension(path.extname(localFilePath)),
    fileName: path.basename(localFilePath)
  };
}

async function readImageUrlAsDataUrl(imageUrl) {
  const asset = await readImageAsset(imageUrl);

  if (!asset) {
    return null;
  }

  return `data:${asset.mimeType};base64,${asset.buffer.toString('base64')}`;
}

module.exports = {
  createSafeFilenameBase,
  getMimeTypeForExtension,
  isSupabaseStorageConfigured,
  storeImageBuffer,
  readImageAsset,
  readImageUrlAsDataUrl,
  supabaseStorageBucket
};
