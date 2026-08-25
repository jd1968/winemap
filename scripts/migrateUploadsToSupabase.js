const fs = require('fs');
const path = require('path');
const { query, closePool } = require('../server/db');
const { isSupabaseStorageConfigured, storeImageBuffer } = require('../server/storage');

const projectRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function isLocalUploadUrl(value) {
  return String(value || '').trim().startsWith('/uploads/');
}

function buildLocalFilePath(uploadUrl) {
  return path.join(projectRoot, String(uploadUrl || '').replace(/^\/+/, ''));
}

function getFolderFromUploadUrl(uploadUrl) {
  const match = String(uploadUrl || '').match(/^\/uploads\/([^/]+)\//);
  return match?.[1] || 'misc';
}

function getOriginalNameFromUploadUrl(uploadUrl) {
  return path.basename(String(uploadUrl || '').trim()) || 'image';
}

async function migrateSingleImageUrl(uploadUrl, cache) {
  const normalizedUrl = String(uploadUrl || '').trim();

  if (!isLocalUploadUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  if (cache.has(normalizedUrl)) {
    return cache.get(normalizedUrl);
  }

  const localFilePath = buildLocalFilePath(normalizedUrl);

  if (!fs.existsSync(localFilePath)) {
    throw new Error(`Local image file not found for ${normalizedUrl}`);
  }

  if (dryRun) {
    const placeholder = `[dry-run]${normalizedUrl}`;
    cache.set(normalizedUrl, placeholder);
    return placeholder;
  }

  const storedImage = await storeImageBuffer({
    buffer: await fs.promises.readFile(localFilePath),
    folder: getFolderFromUploadUrl(normalizedUrl),
    originalName: getOriginalNameFromUploadUrl(normalizedUrl),
    fallbackBase: 'image'
  });

  cache.set(normalizedUrl, storedImage.url);
  return storedImage.url;
}

async function migrateWineImages(cache) {
  const result = await query(
    `
      SELECT id, image_url
      FROM wines
      WHERE COALESCE(image_url, '') <> ''
    `
  );

  let updated = 0;

  for (const row of result.rows) {
    const currentUrl = String(row.image_url || '').trim();

    if (!isLocalUploadUrl(currentUrl)) {
      continue;
    }

    const nextUrl = await migrateSingleImageUrl(currentUrl, cache);

    if (!dryRun) {
      await query('UPDATE wines SET image_url = $2, updated_at = NOW() WHERE id = $1', [row.id, nextUrl]);
    }

    updated += 1;
    console.log(`${dryRun ? 'Would update' : 'Updated'} wine ${row.id}: ${currentUrl} -> ${nextUrl}`);
  }

  return updated;
}

async function migrateTastingImages(cache) {
  const result = await query(
    `
      SELECT id, images
      FROM tastings
      WHERE jsonb_array_length(COALESCE(images, '[]'::jsonb)) > 0
    `
  );

  let updated = 0;

  for (const row of result.rows) {
    const currentImages = Array.isArray(row.images) ? row.images.map((entry) => String(entry || '').trim()).filter(Boolean) : [];

    if (!currentImages.some(isLocalUploadUrl)) {
      continue;
    }

    const nextImages = [];

    for (const imageUrl of currentImages) {
      nextImages.push(await migrateSingleImageUrl(imageUrl, cache));
    }

    if (!dryRun) {
      await query('UPDATE tastings SET images = $2::jsonb, updated_at = NOW() WHERE id = $1', [
        row.id,
        JSON.stringify(nextImages)
      ]);
    }

    updated += 1;
    console.log(`${dryRun ? 'Would update' : 'Updated'} tasting ${row.id}: ${currentImages.length} image(s)`);
  }

  return updated;
}

async function main() {
  if (!isSupabaseStorageConfigured()) {
    throw new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  }

  const cache = new Map();
  console.log(dryRun ? 'Running upload migration in dry-run mode' : 'Migrating local uploads to Supabase Storage');

  const wineUpdates = await migrateWineImages(cache);
  const tastingUpdates = await migrateTastingImages(cache);

  console.log('');
  console.log(`Images migrated: ${cache.size}`);
  console.log(`Wine rows ${dryRun ? 'to update' : 'updated'}: ${wineUpdates}`);
  console.log(`Tasting rows ${dryRun ? 'to update' : 'updated'}: ${tastingUpdates}`);
}

main()
  .catch((error) => {
    console.error('Could not migrate local uploads to Supabase Storage', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
