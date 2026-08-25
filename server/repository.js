const crypto = require('crypto');
const { query } = require('./db');

function normalizeRegionRow(row) {
  return {
    slug: row.slug,
    name: row.name,
    country: row.country,
    coordinates: [row.longitude, row.latitude],
    zoom: row.zoom,
    description: row.description,
    climate: row.climate,
    grapes: row.grapes || [],
    styles: row.styles || [],
    wineStyles: row.wineStyles || [],
    wines: row.wines || [],
    facts: row.facts || []
  };
}

function normalizeWineStyleRow(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    displayOrder: row.displayOrder
  };
}

function normalizeWineRow(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    imageUrl: row.imageUrl || '',
    rating: Number(row.rating || 0),
    styleId: row.styleId || '',
    styleName: row.styleName || '',
    displayOrder: row.displayOrder,
    tastings: row.tastings || []
  };
}

async function getFilters() {
  const countriesPromise = query('SELECT name FROM countries ORDER BY name ASC');
  const stylesPromise = query(`
    SELECT DISTINCT style
    FROM regions
    CROSS JOIN LATERAL jsonb_array_elements_text(styles) AS style
    ORDER BY style ASC
  `);

  const [countriesResult, stylesResult] = await Promise.all([countriesPromise, stylesPromise]);

  return {
    countries: countriesResult.rows.map((row) => row.name),
    styles: stylesResult.rows.map((row) => row.style)
  };
}

async function listRegions({ search = '', country = '', style = '' } = {}) {
  const whereClauses = [];
  const params = [];

  if (country) {
    params.push(country);
    whereClauses.push(`c.name = $${params.length}`);
  }

  if (style) {
    params.push(style);
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(r.styles) AS style_entry
        WHERE LOWER(style_entry) = LOWER($${params.length})
      )
    `);
  }

  if (search) {
    params.push(`%${search}%`);
    whereClauses.push(`
      (
        LOWER(r.name) LIKE LOWER($${params.length})
        OR LOWER(c.name) LIKE LOWER($${params.length})
        OR LOWER(r.description) LIKE LOWER($${params.length})
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(r.grapes) AS grape_entry
          WHERE LOWER(grape_entry) LIKE LOWER($${params.length})
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(r.styles) AS style_entry
          WHERE LOWER(style_entry) LIKE LOWER($${params.length})
        )
        OR EXISTS (
          SELECT 1
          FROM wines w
          WHERE w.region_id = r.id
            AND LOWER(w.name) LIKE LOWER($${params.length})
        )
        OR EXISTS (
          SELECT 1
          FROM wine_styles ws
          WHERE ws.region_id = r.id
            AND LOWER(ws.name) LIKE LOWER($${params.length})
        )
      )
    `);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        r.slug,
        r.name,
        c.name AS country,
        r.longitude,
        r.latitude,
        r.zoom,
        r.description,
        r.climate,
        r.grapes,
        r.styles,
        r.facts,
        COALESCE((
          SELECT json_agg(style_name ORDER BY display_order, style_name)
          FROM (
            SELECT ws.name AS style_name, ws.display_order
            FROM wine_styles ws
            WHERE ws.region_id = r.id
          ) style_rows
        ), '[]'::json) AS "wineStyles",
        COALESCE((
          SELECT json_agg(wine_name ORDER BY display_order, wine_name)
          FROM (
            SELECT w.name AS wine_name, w.display_order
            FROM wines w
            WHERE w.region_id = r.id
          ) wine_rows
        ), '[]'::json) AS wines
      FROM regions r
      JOIN countries c ON c.id = r.country_id
      ${whereSql}
      ORDER BY r.name ASC
    `,
    params
  );

  return result.rows.map(normalizeRegionRow);
}

async function getRegionBySlug(slug) {
  const result = await query(
    `
      SELECT
        r.slug,
        r.name,
        c.name AS country,
        r.longitude,
        r.latitude,
        r.zoom,
        r.description,
        r.climate,
        r.grapes,
        r.styles,
        r.facts,
        COALESCE((
          SELECT json_agg(style_name ORDER BY display_order, style_name)
          FROM (
            SELECT ws.name AS style_name, ws.display_order
            FROM wine_styles ws
            WHERE ws.region_id = r.id
          ) style_rows
        ), '[]'::json) AS "wineStyles",
        COALESCE((
          SELECT json_agg(wine_name ORDER BY display_order, wine_name)
          FROM (
            SELECT w.name AS wine_name, w.display_order
            FROM wines w
            WHERE w.region_id = r.id
          ) wine_rows
        ), '[]'::json) AS wines
      FROM regions r
      JOIN countries c ON c.id = r.country_id
      WHERE r.slug = $1
    `,
    [slug]
  );

  if (!result.rows.length) {
    return null;
  }

  return normalizeRegionRow(result.rows[0]);
}

async function getRegionCount() {
  const result = await query('SELECT COUNT(*)::int AS count FROM regions');
  return result.rows[0]?.count || 0;
}

async function getRegionIdBySlug(slug) {
  const result = await query('SELECT id FROM regions WHERE slug = $1', [slug]);
  return result.rows[0]?.id || null;
}

async function createCountryIfMissing({ name, isoCode = null, centerLat = null, centerLng = null, defaultZoom = null }) {
  const normalizedName = String(name || '').trim();

  if (!normalizedName) {
    return null;
  }

  const existing = await query('SELECT id, name, slug FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1', [normalizedName]);

  if (existing.rows[0]?.id) {
    return existing.rows[0];
  }

  const slugBase = normalizeNameForMatch(normalizedName).replace(/\s+/g, '-');
  const countryId = crypto.randomUUID();

  await query(
    `
      INSERT INTO countries (id, name, slug, iso_code, center_lat, center_lng, default_zoom)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [countryId, normalizedName, slugBase || countryId, isoCode, centerLat, centerLng, defaultZoom]
  );

  return {
    id: countryId,
    name: normalizedName,
    slug: slugBase || countryId
  };
}

async function createRegion({
  countryName,
  name,
  description,
  climate = '',
  latitude,
  longitude,
  zoom = null,
  grapes = [],
  styles = [],
  facts = []
}) {
  const country = await createCountryIfMissing({ name: countryName });

  if (!country?.id) {
    return null;
  }

  const regionId = crypto.randomUUID();
  const slugBase = normalizeNameForMatch(name).replace(/\s+/g, '-');
  let slug = slugBase || regionId;
  let suffix = 2;

  while (await getRegionIdBySlug(slug)) {
    slug = `${slugBase || regionId}-${suffix}`;
    suffix += 1;
  }

  await query(
    `
      INSERT INTO regions (
        id,
        country_id,
        name,
        slug,
        description,
        climate,
        latitude,
        longitude,
        zoom,
        grapes,
        styles,
        facts
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)
    `,
    [
      regionId,
      country.id,
      name,
      slug,
      description,
      climate,
      latitude,
      longitude,
      zoom,
      JSON.stringify(grapes || []),
      JSON.stringify(styles || []),
      JSON.stringify(facts || [])
    ]
  );

  return getRegionBySlug(slug);
}

async function listRegionWineStyles(slug) {
  const result = await query(
    `
      SELECT
        ws.id,
        ws.name,
        COALESCE(ws.notes, '') AS notes,
        ws.display_order AS "displayOrder"
      FROM wine_styles ws
      JOIN regions r ON r.id = ws.region_id
      WHERE r.slug = $1
      ORDER BY ws.display_order ASC, ws.name ASC
    `,
    [slug]
  );

  return result.rows.map(normalizeWineStyleRow);
}

async function getWineStyleById(slug, styleId) {
  const result = await query(
    `
      SELECT
        ws.id,
        ws.name,
        COALESCE(ws.notes, '') AS notes,
        ws.display_order AS "displayOrder"
      FROM wine_styles ws
      JOIN regions r ON r.id = ws.region_id
      WHERE r.slug = $1
        AND ws.id = $2
    `,
    [slug, styleId]
  );

  return result.rows[0] ? normalizeWineStyleRow(result.rows[0]) : null;
}

async function listRegionWines(slug) {
  const result = await query(
    `
      SELECT
        w.id,
        w.name,
        COALESCE(w.notes, '') AS notes,
        COALESCE(w.image_url, '') AS "imageUrl",
        COALESCE(ROUND(AVG(t.rating)::numeric, 1), 0) AS rating,
        COALESCE(w.style_id::text, '') AS "styleId",
        COALESCE(ws.name, '') AS "styleName",
        w.display_order AS "displayOrder",
        COALESCE(
          json_agg(
            json_build_object(
              'id', t.id,
              'date', t.tasted_on,
              'rating', COALESCE(t.rating, 0),
              'price', COALESCE(t.price, ''),
              'images', COALESCE(t.images, '[]'::jsonb),
              'notes', COALESCE(t.notes, '')
            )
            ORDER BY t.tasted_on DESC NULLS LAST, t.created_at DESC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::json
        ) AS tastings
      FROM wines w
      JOIN regions r ON r.id = w.region_id
      LEFT JOIN tastings t ON t.wine_id = w.id
      LEFT JOIN wine_styles ws ON ws.id = w.style_id
      WHERE r.slug = $1
      GROUP BY w.id, ws.name
      ORDER BY w.display_order ASC, w.name ASC
    `,
    [slug]
  );

  return result.rows.map(normalizeWineRow);
}

async function getWineById(slug, wineId) {
  const result = await query(
    `
      SELECT
        w.id,
        w.name,
        COALESCE(w.notes, '') AS notes,
        COALESCE(w.image_url, '') AS "imageUrl",
        COALESCE(ROUND(AVG(t.rating)::numeric, 1), 0) AS rating,
        COALESCE(w.style_id::text, '') AS "styleId",
        COALESCE(ws.name, '') AS "styleName",
        w.display_order AS "displayOrder",
        COALESCE(
          json_agg(
            json_build_object(
              'id', t.id,
              'date', t.tasted_on,
              'rating', COALESCE(t.rating, 0),
              'price', COALESCE(t.price, ''),
              'images', COALESCE(t.images, '[]'::jsonb),
              'notes', COALESCE(t.notes, '')
            )
            ORDER BY t.tasted_on DESC NULLS LAST, t.created_at DESC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::json
        ) AS tastings
      FROM wines w
      JOIN regions r ON r.id = w.region_id
      LEFT JOIN tastings t ON t.wine_id = w.id
      LEFT JOIN wine_styles ws ON ws.id = w.style_id
      WHERE r.slug = $1
        AND w.id = $2
      GROUP BY w.id, ws.name
    `,
    [slug, wineId]
  );

  return result.rows[0] ? normalizeWineRow(result.rows[0]) : null;
}

function normalizeNameForMatch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findWineStyleByName(slug, name) {
  const normalizedName = normalizeNameForMatch(name);

  if (!normalizedName) {
    return null;
  }

  const wineStyles = await listRegionWineStyles(slug);
  return wineStyles.find((wineStyle) => normalizeNameForMatch(wineStyle.name) === normalizedName) || null;
}

async function findWineByName(slug, name) {
  const normalizedName = normalizeNameForMatch(name);

  if (!normalizedName) {
    return null;
  }

  const wines = await listRegionWines(slug);
  return wines.find((wine) => normalizeNameForMatch(wine.name) === normalizedName) || null;
}

async function createWineStyleForRegion(slug, { name, notes = '' }) {
  const regionId = await getRegionIdBySlug(slug);

  if (!regionId) {
    return null;
  }

  const orderResult = await query(
    'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM wine_styles WHERE region_id = $1',
    [regionId]
  );

  const nextOrder = orderResult.rows[0]?.next_order ?? 0;
  const styleId = crypto.randomUUID();

  await query(
    `
      INSERT INTO wine_styles (id, region_id, name, notes, display_order)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [styleId, regionId, name, notes, nextOrder]
  );

  return getWineStyleById(slug, styleId);
}

async function updateWineStyleForRegion(slug, styleId, { name, notes = '' }) {
  const result = await query(
    `
      UPDATE wine_styles ws
      SET
        name = $3,
        notes = $4,
        updated_at = NOW()
      FROM regions r
      WHERE ws.region_id = r.id
        AND r.slug = $1
        AND ws.id = $2
      RETURNING ws.id
    `,
    [slug, styleId, name, notes]
  );

  if (!result.rows[0]?.id) {
    return null;
  }

  return getWineStyleById(slug, styleId);
}

async function deleteWineStyleForRegion(slug, styleId) {
  const result = await query(
    `
      DELETE FROM wine_styles ws
      USING regions r
      WHERE ws.region_id = r.id
        AND r.slug = $1
        AND ws.id = $2
      RETURNING ws.id
    `,
    [slug, styleId]
  );

  return Boolean(result.rowCount);
}

async function createWineForRegion(slug, { name, notes = '', imageUrl = '', styleId = null }) {
  const regionId = await getRegionIdBySlug(slug);

  if (!regionId) {
    return null;
  }

  const orderResult = await query(
    'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM wines WHERE region_id = $1',
    [regionId]
  );

  const nextOrder = orderResult.rows[0]?.next_order ?? 0;
  const wineId = crypto.randomUUID();

  await query(
    `
      INSERT INTO wines (id, region_id, name, notes, image_url, style_id, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [wineId, regionId, name, notes, imageUrl, styleId || null, nextOrder]
  );

  return getWineById(slug, wineId);
}

async function updateWineForRegion(slug, wineId, { name, notes = '', imageUrl = '', styleId = null }) {
  const result = await query(
    `
      UPDATE wines w
      SET
        name = $3,
        notes = $4,
        image_url = $5,
        style_id = $6,
        updated_at = NOW()
      FROM regions r
      WHERE w.region_id = r.id
        AND r.slug = $1
        AND w.id = $2
      RETURNING w.id
    `,
    [slug, wineId, name, notes, imageUrl, styleId || null]
  );

  if (!result.rows[0]?.id) {
    return null;
  }

  return getWineById(slug, wineId);
}

async function deleteWineForRegion(slug, wineId) {
  const result = await query(
    `
      DELETE FROM wines w
      USING regions r
      WHERE w.region_id = r.id
        AND r.slug = $1
        AND w.id = $2
      RETURNING w.id
    `,
    [slug, wineId]
  );

  return Boolean(result.rowCount);
}

async function createTastingForWine(slug, wineId, { date = null, rating = 0, price = '', images = [], notes = '' }) {
  const wine = await getWineById(slug, wineId);

  if (!wine) {
    return null;
  }

  const tastingId = crypto.randomUUID();

  await query(
    `
      INSERT INTO tastings (id, wine_id, tasted_on, rating, price, images, notes)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [tastingId, wineId, date || null, rating, price, JSON.stringify(images || []), notes]
  );

  return getWineById(slug, wineId);
}

async function updateTastingForWine(slug, wineId, tastingId, { date = null, rating = 0, price = '', images = [], notes = '' }) {
  const result = await query(
    `
      UPDATE tastings t
      SET
        tasted_on = $4,
        rating = $5,
        price = $6,
        images = $7::jsonb,
        notes = $8,
        updated_at = NOW()
      FROM wines w
      JOIN regions r ON r.id = w.region_id
      WHERE t.wine_id = w.id
        AND r.slug = $1
        AND w.id = $2
        AND t.id = $3
      RETURNING t.id
    `,
    [slug, wineId, tastingId, date || null, rating, price, JSON.stringify(images || []), notes]
  );

  if (!result.rows[0]?.id) {
    return null;
  }

  return getWineById(slug, wineId);
}

async function deleteTastingForWine(slug, wineId, tastingId) {
  const result = await query(
    `
      DELETE FROM tastings t
      USING wines w, regions r
      WHERE t.wine_id = w.id
        AND w.region_id = r.id
        AND r.slug = $1
        AND w.id = $2
        AND t.id = $3
      RETURNING t.id
    `,
    [slug, wineId, tastingId]
  );

  if (!result.rowCount) {
    return null;
  }

  return getWineById(slug, wineId);
}

module.exports = {
  getFilters,
  listRegions,
  getRegionBySlug,
  getRegionCount,
  createCountryIfMissing,
  createRegion,
  listRegionWineStyles,
  getWineStyleById,
  findWineStyleByName,
  createWineStyleForRegion,
  updateWineStyleForRegion,
  deleteWineStyleForRegion,
  listRegionWines,
  getWineById,
  findWineByName,
  createWineForRegion,
  updateWineForRegion,
  deleteWineForRegion,
  createTastingForWine,
  updateTastingForWine,
  deleteTastingForWine
};
