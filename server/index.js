const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const { query } = require('./db');
const {
  buildWineStyleNotesPrompt,
  buildWineNotesPrompt,
  buildWineImagePrompt,
  buildWineStyleExamplesPrompt,
  buildFastAddFromPhotoPrompt,
  buildRegionCreationPrompt
} = require('./aiPrompts');
const {
  getFilters,
  getRegionBySlug,
  getRegionCount,
  listRegions,
  listRegionWineStyles,
  listRegionWines,
  getWineById,
  findWineByName,
  findWineStyleByName,
  createRegion,
  createWineStyleForRegion,
  updateWineStyleForRegion,
  deleteWineStyleForRegion,
  createWineForRegion,
  updateWineForRegion,
  deleteWineForRegion,
  createTastingForWine,
  updateTastingForWine,
  deleteTastingForWine
} = require('./repository');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '127.0.0.1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const projectRoot = path.resolve(__dirname, '..');
const uploadsRoot = path.join(projectRoot, 'uploads');
const tastingUploadsDir = path.join(uploadsRoot, 'tastings');
const wineUploadsDir = path.join(uploadsRoot, 'wines');
const FAST_ADD_MAX_IMAGES = 8;
let openaiClient = null;

fs.mkdirSync(tastingUploadsDir, { recursive: true });
fs.mkdirSync(wineUploadsDir, { recursive: true });

function createStorage(destinationDir) {
  return multer.diskStorage({
    destination: (req, file, callback) => {
      callback(null, destinationDir);
    },
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      const safeBase = path.basename(file.originalname || 'image', extension)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'image';

      callback(null, `${Date.now()}-${safeBase}${extension || '.jpg'}`);
    }
  });
}

function normalizeRating(value) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(5, parsed));
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return openaiClient;
}

function createSafeFilenameBase(value, fallback = 'image') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || fallback;
}

async function persistGeneratedWineImage(wineName, imageBase64) {
  const filename = `${Date.now()}-${createSafeFilenameBase(wineName, 'wine')}.png`;
  const filePath = path.join(wineUploadsDir, filename);
  await fs.promises.writeFile(filePath, Buffer.from(imageBase64, 'base64'));
  return `/uploads/wines/${filename}`;
}

function parseJsonObjectFromText(text) {
  const value = String(text || '').trim();

  if (!value) {
    return null;
  }

  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : value;

  return JSON.parse(candidate);
}

function normalizeNameForMatch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUploadFilePath(uploadUrl) {
  const value = String(uploadUrl || '').trim();

  if (!value.startsWith('/uploads/')) {
    return null;
  }

  return path.join(projectRoot, value.replace(/^\/+/, ''));
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
    default:
      return 'image/jpeg';
  }
}

async function buildImageInputsFromUploadUrls(imageUrls) {
  const uniqueUrls = Array.from(new Set((imageUrls || []).map((entry) => String(entry || '').trim()).filter(Boolean)));
  const inputs = [];

  for (const imageUrl of uniqueUrls.slice(0, FAST_ADD_MAX_IMAGES)) {
    const filePath = buildUploadFilePath(imageUrl);

    if (!filePath) {
      continue;
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    inputs.push({
      type: 'input_image',
      image_url: `data:${getMimeTypeForExtension(path.extname(filePath))};base64,${fileBuffer.toString('base64')}`
    });
  }

  return inputs;
}

function buildDataUrlFromBuffer(fileBuffer, filePath) {
  return `data:${getMimeTypeForExtension(path.extname(filePath))};base64,${fileBuffer.toString('base64')}`;
}

function findMatchingRegion(regions, regionName, countryName) {
  const normalizedRegionName = normalizeNameForMatch(regionName);
  const normalizedCountryName = normalizeNameForMatch(countryName);

  if (!normalizedRegionName && !normalizedCountryName) {
    return null;
  }

  return regions.find((region) => {
    const regionMatches = normalizedRegionName
      ? normalizeNameForMatch(region.name) === normalizedRegionName
      : true;
    const countryMatches = normalizedCountryName
      ? normalizeNameForMatch(region.country) === normalizedCountryName
      : true;

    return regionMatches && countryMatches;
  }) || null;
}

function normalizeFastAddProposal(rawProposal, imageUrls, region, wineStyles = [], matchedWine = null) {
  const proposedStyleName = String(rawProposal?.wineStyleName || '').trim();
  const matchedStyle = proposedStyleName
    ? wineStyles.find((wineStyle) => normalizeNameForMatch(wineStyle.name) === normalizeNameForMatch(proposedStyleName))
    : null;

  return {
    regionSlug: region?.slug || '',
    regionName: region?.name || String(rawProposal?.regionName || '').trim(),
    countryName: region?.country || String(rawProposal?.countryName || '').trim(),
    wineId: matchedWine?.id || '',
    wineName: String(rawProposal?.wineName || '').trim(),
    producer: String(rawProposal?.producer || '').trim(),
    vintage: String(rawProposal?.vintage || '').trim(),
    wineStyleId: matchedStyle?.id || '',
    wineStyleName: matchedStyle?.name || proposedStyleName,
    tastingDate: String(rawProposal?.tastingDate || '').trim(),
    tastingPrice: String(rawProposal?.tastingPrice || '').trim(),
    tastingRating: normalizeRating(rawProposal?.tastingRating),
    wineNotes: String(rawProposal?.wineNotes || '').trim(),
    tastingNotes: String(rawProposal?.tastingNotes || '').trim(),
    confidenceSummary: String(rawProposal?.confidenceSummary || '').trim(),
    imageUrls: Array.from(new Set((imageUrls || []).map((entry) => String(entry || '').trim()).filter(Boolean))),
    createTasting: true
  };
}

function estimateZoomFromBoundingBox(boundingBox) {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) {
    return 6;
  }

  const values = boundingBox.map((entry) => Number.parseFloat(entry));
  if (values.some((entry) => Number.isNaN(entry))) {
    return 6;
  }

  const [south, north, west, east] = values;
  const latSpan = Math.max(Math.abs(north - south), 0.05);
  const lngSpan = Math.max(Math.abs(east - west), 0.05);
  const maxSpan = Math.max(latSpan, lngSpan);

  if (maxSpan > 18) return 4.2;
  if (maxSpan > 10) return 4.8;
  if (maxSpan > 6) return 5.3;
  if (maxSpan > 3) return 5.9;
  if (maxSpan > 1.5) return 6.5;
  if (maxSpan > 0.8) return 7.1;
  if (maxSpan > 0.4) return 7.8;
  return 8.6;
}

function sanitizeStringList(values, limit = 8) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  ).slice(0, limit);
}

async function describeReferenceWineImage(client, filePath, wine) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'Describe this wine bottle image for use in generating a cleaner, full-bottle studio product image.',
              'Focus on bottle shape, glass colour, closure, label layout, prominent colours, producer text, and any visible vintage or region cues.',
              'Return plain text only, concise but specific.',
              `Wine name: ${wine.name}`
            ].join('\n')
          },
          {
            type: 'input_image',
            image_url: buildDataUrlFromBuffer(fileBuffer, filePath),
            detail: 'high'
          }
        ]
      }
    ]
  });

  return String(response.output_text || '').trim();
}

const upload = multer({
  storage: createStorage(tastingUploadsDir),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 8
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('Only image uploads are allowed'));
      return;
    }

    callback(null, true);
  }
});

const wineImageUpload = multer({
  storage: createStorage(wineUploadsDir),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('Only image uploads are allowed'));
      return;
    }

    callback(null, true);
  }
});

const fastAddUpload = multer({
  storage: createStorage(tastingUploadsDir),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: FAST_ADD_MAX_IMAGES
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('Only image uploads are allowed'));
      return;
    }

    callback(null, true);
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsRoot));

app.get('/api/health', async (req, res) => {
  try {
    const regionCount = await getRegionCount();
    res.json({
      ok: true,
      database: 'postgres',
      regionCount,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed', error);
    res.status(500).json({
      ok: false,
      error: 'Database connection failed'
    });
  }
});

app.get('/api/regions', async (req, res) => {
  try {
    const search = String(req.query.q || '').trim();
    const country = String(req.query.country || '').trim();
    const style = String(req.query.style || '').trim();

    const [regions, filters, totalResult] = await Promise.all([
      listRegions({ search, country, style }),
      getFilters(),
      query('SELECT COUNT(*)::int AS count FROM regions')
    ]);

    res.json({
      regions,
      filters,
      summary: {
        totalRegions: totalResult.rows[0]?.count || 0,
        visibleRegions: regions.length
      }
    });
  } catch (error) {
    console.error('Could not load regions', error);
    res.status(500).json({ error: 'Could not load wine regions' });
  }
});

app.post('/api/regions/add-generated', async (req, res) => {
  try {
    const country = String(req.body?.country || '').trim();
    const name = String(req.body?.name || '').trim();
    const client = getOpenAIClient();

    if (!country || !name) {
      res.status(400).json({ error: 'Country and region name are required.' });
      return;
    }

    const geocodeUrl = new URL('https://nominatim.openstreetmap.org/search');
    geocodeUrl.searchParams.set('format', 'jsonv2');
    geocodeUrl.searchParams.set('limit', '1');
    geocodeUrl.searchParams.set('addressdetails', '1');
    geocodeUrl.searchParams.set('namedetails', '1');
    geocodeUrl.searchParams.set('q', `${name}, ${country}`);

    const geocodeResponse = await fetch(geocodeUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'winemap/1.0 (region creation)'
      }
    });

    if (!geocodeResponse.ok) {
      res.status(502).json({ error: 'Could not look up this region boundary.' });
      return;
    }

    const geocodeResults = await geocodeResponse.json();
    const bestMatch = Array.isArray(geocodeResults) ? geocodeResults[0] : null;

    if (!bestMatch?.lat || !bestMatch?.lon) {
      res.status(404).json({ error: 'Could not find that region.' });
      return;
    }

    let enrichment = {
      description: `${name} is a wine region in ${country}.`,
      climate: '',
      grapes: [],
      styles: [],
      facts: [],
      wineStyles: []
    };

    if (client) {
      try {
        const enrichmentResponse = await client.responses.create({
          model: OPENAI_MODEL,
          tools: [
            {
              type: 'web_search',
              user_location: {
                type: 'approximate',
                country: 'GB',
                timezone: 'Europe/London'
              },
              search_context_size: 'medium'
            }
          ],
          input: buildRegionCreationPrompt({ country, regionName: name })
        });

        const parsedEnrichment = parseJsonObjectFromText(enrichmentResponse.output_text);
        enrichment = {
          description: String(parsedEnrichment?.description || enrichment.description).trim(),
          climate: String(parsedEnrichment?.climate || '').trim(),
          grapes: sanitizeStringList(parsedEnrichment?.grapes, 8),
          styles: sanitizeStringList(parsedEnrichment?.styles, 8),
          facts: sanitizeStringList(parsedEnrichment?.facts, 5),
          wineStyles: sanitizeStringList(parsedEnrichment?.wineStyles, 5)
        };
      } catch (enrichmentError) {
        console.error(`Could not enrich region ${name}, falling back to geocoded-only create`, enrichmentError);
      }
    }

    const region = await createRegion({
      countryName: country,
      name,
      description: enrichment.description || `${name} is a wine region in ${country}.`,
      climate: enrichment.climate,
      latitude: Number.parseFloat(bestMatch.lat),
      longitude: Number.parseFloat(bestMatch.lon),
      zoom: estimateZoomFromBoundingBox(bestMatch.boundingbox),
      grapes: enrichment.grapes,
      styles: enrichment.styles,
      facts: enrichment.facts
    });

    if (!region?.slug) {
      res.status(500).json({ error: 'Could not create this region.' });
      return;
    }

    const createdWineStyles = [];
    for (const wineStyleName of enrichment.wineStyles) {
      const createdWineStyle = await createWineStyleForRegion(region.slug, {
        name: wineStyleName,
        notes: ''
      });

      if (createdWineStyle) {
        createdWineStyles.push(createdWineStyle);
      }
    }

    const finalRegion = await getRegionBySlug(region.slug);
    res.status(201).json({
      region: finalRegion,
      createdWineStyles
    });
  } catch (error) {
    console.error('Could not create generated region', error);
    res.status(500).json({ error: 'Could not add this region.' });
  }
});

app.get('/api/regions/:slug/wines', async (req, res) => {
  try {
    const [wines, wineStyles] = await Promise.all([
      listRegionWines(req.params.slug),
      listRegionWineStyles(req.params.slug)
    ]);
    res.json({ wines, wineStyles });
  } catch (error) {
    console.error(`Could not load wines for region ${req.params.slug}`, error);
    res.status(500).json({ error: 'Could not load wines' });
  }
});

app.post('/api/fast-add/analyze', fastAddUpload.array('images', FAST_ADD_MAX_IMAGES), async (req, res) => {
  try {
    const client = getOpenAIClient();

    if (!client) {
      res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      return;
    }

    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
      res.status(400).json({ error: 'At least one label photo is required.' });
      return;
    }

    const imageUrls = files.map((file) => `/uploads/tastings/${file.filename}`);
    const regions = await listRegions();
    const imageInputs = await buildImageInputsFromUploadUrls(imageUrls);

    if (!imageInputs.length) {
      res.status(400).json({ error: 'Could not read the uploaded photos.' });
      return;
    }

    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildFastAddFromPhotoPrompt({ regions })
            },
            ...imageInputs
          ]
        }
      ]
    });

    let parsed;
    try {
      parsed = parseJsonObjectFromText(response.output_text);
    } catch (parseError) {
      console.error('Could not parse fast add proposal', parseError);
      res.status(502).json({ error: 'Could not understand the wine data returned by OpenAI.' });
      return;
    }

    const matchedRegion = findMatchingRegion(regions, parsed?.regionName, parsed?.countryName);
    const wineStyles = matchedRegion ? await listRegionWineStyles(matchedRegion.slug) : [];
    const matchedWine = matchedRegion && parsed?.wineName
      ? await findWineByName(matchedRegion.slug, parsed.wineName)
      : null;
    const proposal = normalizeFastAddProposal(parsed, imageUrls, matchedRegion, wineStyles, matchedWine);

    res.status(201).json({
      proposal,
      options: {
        regions: regions.map((region) => ({
          slug: region.slug,
          name: region.name,
          country: region.country
        })),
        wineStyles
      }
    });
  } catch (error) {
    console.error('Could not analyze fast add label photos', error);
    res.status(500).json({ error: 'Could not analyze these label photos.' });
  }
});

app.post('/api/fast-add/create', async (req, res) => {
  try {
    const client = getOpenAIClient();
    const regionSlug = String(req.body?.regionSlug || '').trim();
    const wineId = String(req.body?.wineId || '').trim();
    const wineName = String(req.body?.wineName || '').trim();
    const wineNotes = String(req.body?.wineNotes || '').trim();
    const tastingNotes = String(req.body?.tastingNotes || '').trim();
    const tastingDate = String(req.body?.tastingDate || '').trim();
    const tastingPrice = String(req.body?.tastingPrice || '').trim();
    const tastingRating = normalizeRating(req.body?.tastingRating);
    const imageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const requestedStyleId = String(req.body?.wineStyleId || '').trim();
    const requestedStyleName = String(req.body?.wineStyleName || '').trim();
    const createTasting = req.body?.createTasting !== false;

    if (!regionSlug) {
      res.status(400).json({ error: 'Region is required.' });
      return;
    }

    if (!wineName) {
      res.status(400).json({ error: 'Wine name is required.' });
      return;
    }

    const region = await getRegionBySlug(regionSlug);

    if (!region) {
      res.status(404).json({ error: 'Region not found.' });
      return;
    }

    let wineStyle = null;

    if (requestedStyleId) {
      const regionWineStyles = await listRegionWineStyles(regionSlug);
      wineStyle = regionWineStyles.find((entry) => String(entry.id) === requestedStyleId) || null;
    }

    if (!wineStyle && requestedStyleName) {
      wineStyle = await findWineStyleByName(regionSlug, requestedStyleName);

      if (!wineStyle) {
        wineStyle = await createWineStyleForRegion(regionSlug, {
          name: requestedStyleName,
          notes: ''
        });
      }
    }

    let wine = null;
    let createdWine = false;

    if (wineId) {
      wine = await getWineById(regionSlug, wineId);
    }

    if (!wine) {
      wine = await findWineByName(regionSlug, wineName);
    }

    const preferredImageUrl = imageUrls[0] || '';

    if (!wine) {
      wine = await createWineForRegion(regionSlug, {
        name: wineName,
        notes: wineNotes,
        imageUrl: preferredImageUrl,
        styleId: wineStyle?.id || null
      });
      createdWine = true;
    } else {
      wine = await updateWineForRegion(regionSlug, wine.id, {
        name: wineName,
        notes: wineNotes || wine.notes || '',
        imageUrl: wine.imageUrl || preferredImageUrl,
        styleId: wineStyle?.id || wine.styleId || null
      });
    }

    if (!wine) {
      res.status(500).json({ error: 'Could not create or update the wine.' });
      return;
    }

    if (client && !wine.imageUrl) {
      try {
        const imageResponse = await client.images.generate({
          model: OPENAI_IMAGE_MODEL,
          prompt: buildWineImagePrompt({ region, wine, linkedWineStyle: wineStyle }),
          size: '1024x1024'
        });
        const imageBase64 =
          imageResponse?.data?.[0]?.b64_json ||
          imageResponse?.data?.[0]?.base64 ||
          '';

        if (imageBase64) {
          const imageUrl = await persistGeneratedWineImage(wine.name, imageBase64);
          const updatedWineWithImage = await updateWineForRegion(regionSlug, wine.id, {
            name: wine.name.trim(),
            notes: wine.notes || '',
            imageUrl,
            styleId: wineStyle?.id || wine.styleId || null
          });

          if (updatedWineWithImage) {
            wine = updatedWineWithImage;
          }
        }
      } catch (imageError) {
        console.error('Could not generate fast add wine image', imageError);
      }
    }

    let finalWine = wine;
    let tastingId = null;

    if (createTasting || tastingDate || tastingPrice || tastingNotes || imageUrls.length) {
      finalWine = await createTastingForWine(regionSlug, wine.id, {
        date: tastingDate || null,
        rating: tastingRating,
        price: tastingPrice,
        notes: tastingNotes,
        images: imageUrls
      });
      tastingId = finalWine?.tastings?.[0]?.id || null;
    }

    res.status(201).json({
      region,
      wine: finalWine || wine,
      wineStyle,
      tastingId,
      createdWine,
      reusedWine: !createdWine
    });
  } catch (error) {
    console.error('Could not create records from fast add proposal', error);
    res.status(500).json({ error: 'Could not create records from this proposal.' });
  }
});

app.get('/api/regions/:slug/wine-styles', async (req, res) => {
  try {
    const wineStyles = await listRegionWineStyles(req.params.slug);
    res.json({ wineStyles });
  } catch (error) {
    console.error(`Could not load wine styles for region ${req.params.slug}`, error);
    res.status(500).json({ error: 'Could not load wine styles' });
  }
});

app.post('/api/regions/:slug/wine-styles', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '');

    if (!name) {
      res.status(400).json({ error: 'Wine style name is required' });
      return;
    }

    const wineStyle = await createWineStyleForRegion(req.params.slug, { name, notes });

    if (!wineStyle) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    res.status(201).json({ wineStyle });
  } catch (error) {
    console.error(`Could not create wine style for region ${req.params.slug}`, error);
    res.status(500).json({ error: 'Could not create wine style' });
  }
});

app.put('/api/regions/:slug/wine-styles/:styleId', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '');

    if (!name) {
      res.status(400).json({ error: 'Wine style name is required' });
      return;
    }

    const wineStyle = await updateWineStyleForRegion(req.params.slug, req.params.styleId, { name, notes });

    if (!wineStyle) {
      res.status(404).json({ error: 'Wine style not found' });
      return;
    }

    res.json({ wineStyle });
  } catch (error) {
    console.error(`Could not update wine style ${req.params.styleId}`, error);
    res.status(500).json({ error: 'Could not update wine style' });
  }
});

app.post('/api/regions/:slug/wine-styles/:styleId/generate-notes', async (req, res) => {
  try {
    const client = getOpenAIClient();

    if (!client) {
      res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      return;
    }

    const region = await getRegionBySlug(req.params.slug);

    if (!region) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    const [wineStyles, wines] = await Promise.all([
      listRegionWineStyles(req.params.slug),
      listRegionWines(req.params.slug)
    ]);
    const wineStyle = wineStyles.find((entry) => String(entry.id) === String(req.params.styleId));

    if (!wineStyle) {
      res.status(404).json({ error: 'Wine style not found' });
      return;
    }

    const relatedWines = wines.filter((wine) => String(wine.styleId || '') === String(wineStyle.id));
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: buildWineStyleNotesPrompt({ region, wineStyle, relatedWines })
    });
    const notes = String(response.output_text || '').trim();

    if (!notes) {
      res.status(502).json({ error: 'OpenAI returned an empty response.' });
      return;
    }

    res.json({ notes });
  } catch (error) {
    console.error(`Could not generate notes for wine style ${req.params.styleId}`, error);
    res.status(500).json({ error: 'Could not generate wine style notes' });
  }
});

app.post('/api/regions/:slug/wine-styles/:styleId/find-examples', async (req, res) => {
  try {
    const client = getOpenAIClient();

    if (!client) {
      res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      return;
    }

    const region = await getRegionBySlug(req.params.slug);

    if (!region) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    const [wineStyles, wines] = await Promise.all([
      listRegionWineStyles(req.params.slug),
      listRegionWines(req.params.slug)
    ]);
    const wineStyle = wineStyles.find((entry) => String(entry.id) === String(req.params.styleId));

    if (!wineStyle) {
      res.status(404).json({ error: 'Wine style not found' });
      return;
    }

    const existingWines = wines.filter((wine) => String(wine.styleId || '') === String(wineStyle.id));
    const existingNames = new Set(existingWines.map((wine) => String(wine.name || '').trim().toLowerCase()));

    const response = await client.responses.create({
      model: OPENAI_MODEL,
      tools: [
        {
          type: 'web_search',
          user_location: {
            type: 'approximate',
            country: 'GB',
            timezone: 'Europe/London'
          },
          search_context_size: 'medium'
        }
      ],
      input: buildWineStyleExamplesPrompt({ region, wineStyle, existingWines })
    });

    let parsed;
    try {
      parsed = parseJsonObjectFromText(response.output_text);
    } catch (parseError) {
      console.error('Could not parse AI examples response', parseError);
      res.status(502).json({ error: 'Could not understand the examples returned by OpenAI.' });
      return;
    }

    const examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
    const createdWines = [];

    for (const example of examples.slice(0, 5)) {
      const name = String(example?.name || '').trim();
      const notes = String(example?.notes || '').trim();

      if (!name) {
        continue;
      }

      const normalizedName = name.toLowerCase();
      if (existingNames.has(normalizedName)) {
        continue;
      }

      const createdWine = await createWineForRegion(req.params.slug, {
        name,
        notes,
        styleId: wineStyle.id
      });

      if (createdWine) {
        createdWines.push(createdWine);
        existingNames.add(normalizedName);
      }
    }

    res.json({
      summary: String(parsed?.summary || '').trim(),
      createdWines
    });
  } catch (error) {
    console.error(`Could not find examples for wine style ${req.params.styleId}`, error);
    res.status(500).json({ error: 'Could not find wine style examples' });
  }
});

app.delete('/api/regions/:slug/wine-styles/:styleId', async (req, res) => {
  try {
    const deleted = await deleteWineStyleForRegion(req.params.slug, req.params.styleId);

    if (!deleted) {
      res.status(404).json({ error: 'Wine style not found' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(`Could not delete wine style ${req.params.styleId}`, error);
    res.status(500).json({ error: 'Could not delete wine style' });
  }
});

app.get('/api/regions/:slug', async (req, res) => {
  try {
    const region = await getRegionBySlug(req.params.slug);

    if (!region) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    res.json(region);
  } catch (error) {
    console.error(`Could not load region ${req.params.slug}`, error);
    res.status(500).json({ error: 'Could not load region' });
  }
});

app.post('/api/regions/:slug/wines', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '');
    const imageUrl = String(req.body?.imageUrl || '');
    const styleId = req.body?.styleId ? String(req.body.styleId) : null;

    if (!name) {
      res.status(400).json({ error: 'Wine name is required' });
      return;
    }

    const wine = await createWineForRegion(req.params.slug, { name, notes, imageUrl, styleId });

    if (!wine) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    res.status(201).json({ wine });
  } catch (error) {
    console.error(`Could not create wine for region ${req.params.slug}`, error);
    res.status(500).json({ error: 'Could not create wine' });
  }
});

app.post('/api/regions/:slug/wines/:wineId/generate-notes', async (req, res) => {
  try {
    const client = getOpenAIClient();

    if (!client) {
      res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      return;
    }

    const region = await getRegionBySlug(req.params.slug);

    if (!region) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    const [wines, wineStyles] = await Promise.all([
      listRegionWines(req.params.slug),
      listRegionWineStyles(req.params.slug)
    ]);
    const wine = wines.find((entry) => String(entry.id) === String(req.params.wineId));

    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    const linkedWineStyle = wineStyles.find((entry) => String(entry.id) === String(wine.styleId || ''));
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: buildWineNotesPrompt({ region, wine, linkedWineStyle })
    });
    const notes = String(response.output_text || '').trim();

    if (!notes) {
      res.status(502).json({ error: 'OpenAI returned an empty response.' });
      return;
    }

    res.json({ notes });
  } catch (error) {
    console.error(`Could not generate notes for wine ${req.params.wineId}`, error);
    res.status(500).json({ error: 'Could not generate wine notes' });
  }
});

app.post('/api/regions/:slug/wines/:wineId/generate-image', async (req, res) => {
  try {
    const client = getOpenAIClient();

    if (!client) {
      res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      return;
    }

    const region = await getRegionBySlug(req.params.slug);

    if (!region) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    const [wines, wineStyles] = await Promise.all([
      listRegionWines(req.params.slug),
      listRegionWineStyles(req.params.slug)
    ]);
    const wine = wines.find((entry) => String(entry.id) === String(req.params.wineId));

    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    const linkedWineStyle = wineStyles.find((entry) => String(entry.id) === String(wine.styleId || ''));
    const existingImagePath = wine.imageUrl ? buildUploadFilePath(wine.imageUrl) : null;
    let imageResponse;

    if (existingImagePath) {
      try {
        imageResponse = await client.images.edit({
          model: OPENAI_IMAGE_MODEL,
          image: await OpenAI.toFile(
            await fs.promises.readFile(existingImagePath),
            path.basename(existingImagePath),
            {
              type: getMimeTypeForExtension(path.extname(existingImagePath))
            }
          ),
          prompt: buildWineImagePrompt({
            region,
            wine,
            linkedWineStyle,
            hasReferenceImage: true
          }),
          size: '1024x1024'
        });
      } catch (editError) {
        console.error(`Could not edit reference image for wine ${req.params.wineId}, falling back to guided generation`, editError);
        const referenceImageNotes = await describeReferenceWineImage(client, existingImagePath, wine);
        imageResponse = await client.images.generate({
          model: OPENAI_IMAGE_MODEL,
          prompt: buildWineImagePrompt({
            region,
            wine,
            linkedWineStyle,
            hasReferenceImage: true,
            referenceImageNotes
          }),
          size: '1024x1024'
        });
      }
    } else {
      imageResponse = await client.images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: buildWineImagePrompt({
          region,
          wine,
          linkedWineStyle,
          hasReferenceImage: false
        }),
        size: '1024x1024'
      });
    }
    const imageBase64 =
      imageResponse?.data?.[0]?.b64_json ||
      imageResponse?.data?.[0]?.base64 ||
      '';

    if (!imageBase64) {
      res.status(502).json({ error: 'OpenAI did not return any image data.' });
      return;
    }

    const imageUrl = await persistGeneratedWineImage(wine.name, imageBase64);
    const updatedWine = await updateWineForRegion(req.params.slug, req.params.wineId, {
      name: wine.name.trim(),
      notes: wine.notes || '',
      imageUrl,
      styleId: wine.styleId || null
    });

    if (!updatedWine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    res.json({ wine: updatedWine, imageUrl });
  } catch (error) {
    console.error(`Could not generate image for wine ${req.params.wineId}`, error);
    res.status(500).json({ error: 'Could not generate wine image' });
  }
});

app.put('/api/regions/:slug/wines/:wineId', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '');
    const imageUrl = String(req.body?.imageUrl || '');
    const styleId = req.body?.styleId ? String(req.body.styleId) : null;

    if (!name) {
      res.status(400).json({ error: 'Wine name is required' });
      return;
    }

    const wine = await updateWineForRegion(req.params.slug, req.params.wineId, { name, notes, imageUrl, styleId });

    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    res.json({ wine });
  } catch (error) {
    console.error(`Could not update wine ${req.params.wineId}`, error);
    res.status(500).json({ error: 'Could not update wine' });
  }
});

app.post('/api/regions/:slug/wines/:wineId/tastings', async (req, res) => {
  try {
    const tasting = {
      date: req.body?.date ? String(req.body.date) : null,
      rating: normalizeRating(req.body?.rating),
      price: String(req.body?.price || ''),
      notes: String(req.body?.notes || ''),
      images: Array.isArray(req.body?.images)
        ? req.body.images.map((entry) => String(entry).trim()).filter(Boolean)
        : []
    };

    const wine = await createTastingForWine(req.params.slug, req.params.wineId, tasting);

    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    res.status(201).json({ wine });
  } catch (error) {
    console.error(`Could not create tasting for wine ${req.params.wineId}`, error);
    res.status(500).json({ error: 'Could not create tasting' });
  }
});

app.post('/api/uploads/images', upload.array('images', 8), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const images = files.map((file) => ({
      url: `/uploads/tastings/${file.filename}`,
      name: file.originalname
    }));

    res.status(201).json({ images });
  } catch (error) {
    console.error('Could not upload tasting images', error);
    res.status(500).json({ error: 'Could not upload images' });
  }
});

app.post('/api/uploads/wine-image', wineImageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Image file is required' });
      return;
    }

    res.status(201).json({
      image: {
        url: `/uploads/wines/${req.file.filename}`,
        name: req.file.originalname
      }
    });
  } catch (error) {
    console.error('Could not upload wine image', error);
    res.status(500).json({ error: 'Could not upload wine image' });
  }
});

app.put('/api/regions/:slug/wines/:wineId/tastings/:tastingId', async (req, res) => {
  try {
    const tasting = {
      date: req.body?.date ? String(req.body.date) : null,
      rating: normalizeRating(req.body?.rating),
      price: String(req.body?.price || ''),
      notes: String(req.body?.notes || ''),
      images: Array.isArray(req.body?.images)
        ? req.body.images.map((entry) => String(entry).trim()).filter(Boolean)
        : []
    };

    const wine = await updateTastingForWine(
      req.params.slug,
      req.params.wineId,
      req.params.tastingId,
      tasting
    );

    if (!wine) {
      res.status(404).json({ error: 'Tasting not found' });
      return;
    }

    res.json({ wine });
  } catch (error) {
    console.error(`Could not update tasting ${req.params.tastingId}`, error);
    res.status(500).json({ error: 'Could not update tasting' });
  }
});

app.delete('/api/regions/:slug/wines/:wineId/tastings/:tastingId', async (req, res) => {
  try {
    const wine = await deleteTastingForWine(
      req.params.slug,
      req.params.wineId,
      req.params.tastingId
    );

    if (!wine) {
      res.status(404).json({ error: 'Tasting not found' });
      return;
    }

    res.json({ wine });
  } catch (error) {
    console.error(`Could not delete tasting ${req.params.tastingId}`, error);
    res.status(500).json({ error: 'Could not delete tasting' });
  }
});

app.delete('/api/regions/:slug/wines/:wineId', async (req, res) => {
  try {
    const deleted = await deleteWineForRegion(req.params.slug, req.params.wineId);

    if (!deleted) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(`Could not delete wine ${req.params.wineId}`, error);
    res.status(500).json({ error: 'Could not delete wine' });
  }
});

async function startServer() {
  try {
    await query('SELECT NOW()');
    app.listen(PORT, HOST, () => {
      console.log(`Wine atlas server listening on http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('Could not start server because PostgreSQL is unavailable', error);
    process.exit(1);
  }
}

startServer();
