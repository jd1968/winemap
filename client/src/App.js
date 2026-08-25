import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './App.css';

const COUNTRIES_GEOJSON_URL =
  'https://raw.githubusercontent.com/datasets/geo-countries/main/data/countries.geojson';

const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm'
    }
  ]
};

const WINE_BOTTLE_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <g fill="none" fill-rule="evenodd">
      <path d="M12 3.5h4v4.6c0 1.2.4 2.3 1.1 3.2l1.4 1.8c.9 1.1 1.4 2.5 1.4 3.9v5.7c0 1.6-1.3 2.8-2.8 2.8h-6.2c-1.6 0-2.8-1.3-2.8-2.8V17c0-1.4.5-2.8 1.4-3.9l1.4-1.8c.7-.9 1.1-2 1.1-3.2V3.5Z" fill="#7c2d12"/>
      <path d="M11 16.2h8" stroke="#ffedd5" stroke-width="1.5" stroke-linecap="round" opacity=".9"/>
      <path d="M12.4 2h3.2c.5 0 .9.4.9.9v.6c0 .5-.4.9-.9.9h-3.2c-.5 0-.9-.4-.9-.9v-.6c0-.5.4-.9.9-.9Z" fill="#451a03"/>
      <path d="M10.2 24.5h7.6" stroke="#451a03" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>
    </g>
  </svg>
`;

const COUNTRY_NAME_ALIASES = {
  'united states of america': 'United States'
};

function normalizeRouteState(route = {}) {
  const country = route.country && route.country !== 'All' ? route.country : 'All';
  const region = route.region ? String(route.region) : null;
  const editor = route.editor === 'styles' ? 'styles' : route.editor === 'wines' ? 'wines' : null;
  const wineId = route.wineId ? String(route.wineId) : null;
  const styleId = route.styleId ? String(route.styleId) : null;
  const tastingId = route.tastingId ? String(route.tastingId) : null;

  if (!region) {
    return {
      country,
      region: null,
      editor: null,
      wineId: null,
      styleId: null,
      tastingId: null
    };
  }

  if (!editor) {
    return {
      country,
      region,
      editor: null,
      wineId: null,
      styleId: null,
      tastingId: null
    };
  }

  if (editor === 'styles') {
    return {
      country,
      region,
      editor,
      wineId: null,
      styleId,
      tastingId: null
    };
  }

  return {
    country,
    region,
    editor,
    wineId,
    styleId,
    tastingId: wineId ? tastingId : null
  };
}

function parseLocationRoute(search) {
  const params = new URLSearchParams(search || '');

  return normalizeRouteState({
    country: params.get('country') || 'All',
    region: params.get('region'),
    editor: params.get('editor'),
    wineId: params.get('wine'),
    styleId: params.get('style'),
    tastingId: params.get('tasting')
  });
}

function buildRouteSearch(route) {
  const normalized = normalizeRouteState(route);
  const params = new URLSearchParams();

  if (normalized.country !== 'All') {
    params.set('country', normalized.country);
  }

  if (normalized.region) {
    params.set('region', normalized.region);
  }

  if (normalized.editor) {
    params.set('editor', normalized.editor);
  }

  if (normalized.editor === 'wines' && normalized.wineId) {
    params.set('wine', normalized.wineId);
  }

  if (normalized.editor === 'wines' && normalized.styleId) {
    params.set('style', normalized.styleId);
  }

  if (normalized.editor === 'wines' && normalized.wineId && normalized.tastingId) {
    params.set('tasting', normalized.tastingId);
  }

  if (normalized.editor === 'styles' && normalized.styleId) {
    params.set('style', normalized.styleId);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

function enforceWorldView(map) {
  map.stop();
  map.resize();
  map.jumpTo({
    center: [0, 16],
    zoom: 0
  });
}

function animateWorldView(map) {
  map.stop();
  map.resize();
  map.easeTo({
    center: [0, 16],
    zoom: 0,
    duration: 1400,
    curve: 1.45,
    easing: (value) => 1 - Math.pow(1 - value, 3),
    essential: true
  });
}

function buildGeoJson(regions) {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => ({
      type: 'Feature',
      properties: {
        slug: region.slug,
        name: region.name,
        country: region.country,
        climate: region.climate
      },
      geometry: {
        type: 'Point',
        coordinates: region.coordinates
      }
    }))
  };
}

function normalizeCountryName(countryName) {
  const normalized = String(countryName || '').trim().toLowerCase();
  return COUNTRY_NAME_ALIASES[normalized] || String(countryName || '').trim();
}

function getFeatureCountryName(feature) {
  const rawName = feature?.properties?.name || feature?.properties?.ADMIN || feature?.properties?.NAME;
  return normalizeCountryName(rawName);
}

function buildCountryGeoJson(features, allowedCountries) {
  return {
    type: 'FeatureCollection',
    features: features
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          countryName: getFeatureCountryName(feature)
        }
      }))
      .filter((feature) => allowedCountries.has(feature.properties.countryName))
  };
}

function extendBounds(bounds, coordinates) {
  if (!Array.isArray(coordinates[0])) {
    bounds.extend(coordinates);
    return;
  }

  coordinates.forEach((entry) => extendBounds(bounds, entry));
}

function getPolygonAreaEstimate(ring) {
  let area = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += (x1 * y2) - (x2 * y1);
  }

  return Math.abs(area / 2);
}

function isPointInRing(point, ring) {
  const [lng, lat] = point;
  let inside = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [x1, y1] = ring[current];
    const [x2, y2] = ring[previous];

    const intersects =
      ((y1 > lat) !== (y2 > lat)) &&
      (lng < ((x2 - x1) * (lat - y1)) / ((y2 - y1) || Number.EPSILON) + x1);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInPolygon(point, polygonCoordinates) {
  if (!polygonCoordinates.length || !isPointInRing(point, polygonCoordinates[0])) {
    return false;
  }

  for (let holeIndex = 1; holeIndex < polygonCoordinates.length; holeIndex += 1) {
    if (isPointInRing(point, polygonCoordinates[holeIndex])) {
      return false;
    }
  }

  return true;
}

function getCountryFocusGeometry(feature, countryRegions) {
  if (!feature?.geometry) {
    return feature?.geometry || null;
  }

  if (feature.geometry.type === 'Polygon') {
    return feature.geometry;
  }

  if (feature.geometry.type !== 'MultiPolygon') {
    return feature.geometry;
  }

  const scoredPolygons = feature.geometry.coordinates.map((polygonCoordinates) => {
    const matchingRegions = countryRegions.filter((region) =>
      isPointInPolygon(region.coordinates, polygonCoordinates)
    ).length;

    const areaEstimate = getPolygonAreaEstimate(polygonCoordinates[0] || []);

    return {
      polygonCoordinates,
      matchingRegions,
      areaEstimate
    };
  });

  scoredPolygons.sort((left, right) => {
    if (right.matchingRegions !== left.matchingRegions) {
      return right.matchingRegions - left.matchingRegions;
    }

    return right.areaEstimate - left.areaEstimate;
  });

  return {
    type: 'Polygon',
    coordinates: scoredPolygons[0]?.polygonCoordinates || feature.geometry.coordinates[0]
  };
}

function getFeatureBounds(maplibregl, feature) {
  const bounds = new maplibregl.LngLatBounds();
  extendBounds(bounds, feature.geometry.coordinates);
  return bounds;
}

function RegionTags({ items, onItemClick }) {
  return (
    <div className="tag-row">
      {items.map((item) => (
        onItemClick ? (
          <button
            key={item}
            type="button"
            className="tag-chip tag-chip--button"
            onClick={(event) => {
              event.stopPropagation();
              onItemClick(item);
            }}
          >
            {item}
          </button>
        ) : (
          <span key={item} className="tag-chip">
            {item}
          </span>
        )
      ))}
    </div>
  );
}

function parseImageText(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildUploadUrl(imageUrl) {
  if (!imageUrl) {
    return '';
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }

  if (window.location.port === '3000') {
    return `${window.location.protocol}//${window.location.hostname}:5001${imageUrl}`;
  }

  return `${window.location.origin}${imageUrl}`;
}

function summarizeNotes(value, limit = 50) {
  const text = String(value || '').trim();

  if (!text) {
    return 'No notes yet.';
  }

  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s)]+/gi) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;!?]+$/, ''))));
}

function NoteLinks({ value }) {
  const urls = extractUrls(value);

  if (!urls.length) {
    return null;
  }

  return (
    <div className="note-links">
      <span className="note-links__label">Links</span>
      <div className="note-links__items">
        {urls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="note-links__item"
          >
            {url}
          </a>
        ))}
      </div>
    </div>
  );
}

function StarRating({ value, onChange, label = 'Rating' }) {
  return (
    <div className="field-block">
      <span>{label}</span>
      <div className="star-rating" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((starValue) => (
          <button
            key={starValue}
            type="button"
            className={`star-rating__star ${starValue <= value ? 'is-active' : ''}`}
            aria-label={`${starValue} star${starValue === 1 ? '' : 's'}`}
            aria-pressed={starValue === value}
            onClick={() => onChange(starValue === value ? 0 : starValue)}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function StarRatingInline({ value }) {
  const roundedValue = Number(value || 0);

  return (
    <div className="star-rating star-rating--display star-rating--inline" aria-label={`${roundedValue} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((starValue) => (
        <span
          key={starValue}
          className={`star-rating__star ${starValue <= roundedValue ? 'is-active' : ''}`}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
    </div>
  );
}

function AutoGrowTextarea({ value, onChange, className = '', minRows = 6, ...props }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      rows={minRows}
      className={className}
      value={value}
      onChange={onChange}
    />
  );
}

const AI_LOADING_GIF_URL =
  'https://commons.wikimedia.org/wiki/Special:Redirect/file/Loading_2_transparent.gif';

function SparkleAiIcon() {
  return (
    <svg
      className="ai-action-button__svg"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2.25" y="2.25" width="19.5" height="19.5" rx="4.75" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 5.2L8.82 8.18L11.8 9L8.82 9.82L8 12.8L7.18 9.82L4.2 9L7.18 8.18L8 5.2Z"
        fill="currentColor"
      />
      <path
        d="M15.7 6L16.95 10.55L21.5 11.8L16.95 13.05L15.7 17.6L14.45 13.05L9.9 11.8L14.45 10.55L15.7 6Z"
        fill="currentColor"
      />
      <path
        d="M11.1 13.55L11.72 15.78L13.95 16.4L11.72 17.02L11.1 19.25L10.48 17.02L8.25 16.4L10.48 15.78L11.1 13.55Z"
        fill="currentColor"
      />
    </svg>
  );
}

function normalizeEditorTasting(tasting) {
  const images = Array.isArray(tasting?.images) ? tasting.images : [];

  return {
    id: tasting?.id || `draft-${Math.random().toString(36).slice(2)}`,
    date: tasting?.date ? String(tasting.date).slice(0, 10) : '',
    rating: Number.isInteger(tasting?.rating) ? tasting.rating : 0,
    price: tasting?.price || '',
    notes: tasting?.notes || '',
    images,
    imagesText: images.join('\n'),
    isNew: Boolean(tasting?.isNew)
  };
}

function normalizeEditorWine(wine) {
  return {
    id: wine.id,
    name: wine.name || '',
    notes: wine.notes || '',
    imageUrl: wine.imageUrl || '',
    rating: Number(wine.rating || 0),
    styleId: wine.styleId || '',
    styleName: wine.styleName || '',
    displayOrder: wine.displayOrder,
    tastings: Array.isArray(wine.tastings) ? wine.tastings.map(normalizeEditorTasting) : []
  };
}

function normalizeEditorWineStyle(wineStyle) {
  return {
    id: wineStyle.id,
    name: wineStyle.name || '',
    notes: wineStyle.notes || '',
    displayOrder: wineStyle.displayOrder
  };
}

function normalizeFastAddDraft(proposal = {}) {
  return {
    regionSlug: String(proposal.regionSlug || ''),
    regionName: String(proposal.regionName || ''),
    countryName: String(proposal.countryName || ''),
    wineId: String(proposal.wineId || ''),
    wineName: String(proposal.wineName || ''),
    producer: String(proposal.producer || ''),
    vintage: String(proposal.vintage || ''),
    wineStyleId: String(proposal.wineStyleId || ''),
    wineStyleName: String(proposal.wineStyleName || ''),
    tastingDate: String(proposal.tastingDate || ''),
    tastingPrice: String(proposal.tastingPrice || ''),
    tastingRating: Number(proposal.tastingRating || 0),
    wineNotes: String(proposal.wineNotes || ''),
    tastingNotes: String(proposal.tastingNotes || ''),
    confidenceSummary: String(proposal.confidenceSummary || ''),
    imageUrls: Array.isArray(proposal.imageUrls) ? proposal.imageUrls.filter(Boolean) : [],
    createTasting: proposal.createTasting !== false
  };
}

function FastAddModal({
  isOpen,
  draft,
  regionOptions,
  wineStyleOptions,
  busy,
  error,
  stage,
  onClose,
  onAnalyze,
  onFieldChange,
  onRegionChange,
  onCreate
}) {
  const uploadInputId = 'fast-add-upload-input';

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fast-add-modal">
      <div className="fast-add-modal__backdrop" onClick={busy ? undefined : onClose} />
      <section className="fast-add-modal__panel">
        <div className="fast-add-modal__header">
          <div>
            <p className="eyebrow">Fast Add</p>
            <h2>Fast Add from Photo</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        {error ? <div className="state-card state-card--error">{error}</div> : null}

        {stage === 'upload' ? (
          <div className="editor-card fast-add-upload-screen">
            <p>Upload one or more label photos and the app will propose the wine, region, style, tasting details, and images.</p>
            <label htmlFor={uploadInputId} className="fast-add-upload-tile">
              <input
                id={uploadInputId}
                className="image-upload-panel__input"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  if (files.length) {
                    onAnalyze(files);
                  }
                  event.target.value = '';
                }}
                disabled={busy}
              />
              <span className="image-upload-tile__plus" aria-hidden="true">+</span>
              <strong>{busy ? 'Analyzing labels…' : 'Upload label photos'}</strong>
            </label>
          </div>
        ) : (
          <div className="editor-card fast-add-form">
            <div className="fast-add-preview-grid">
              {draft.imageUrls.map((imageUrl) => (
                <a
                  key={imageUrl}
                  href={buildUploadUrl(imageUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="tasting-image-link"
                >
                  <img src={buildUploadUrl(imageUrl)} alt="" className="tasting-image" />
                </a>
              ))}
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Region</span>
                <select value={draft.regionSlug} onChange={(event) => onRegionChange(event.target.value)} disabled={busy}>
                  <option value="">Choose region</option>
                  {regionOptions.map((region) => (
                    <option key={region.slug} value={region.slug}>
                      {region.name} ({region.country})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Wine style</span>
                <select
                  value={draft.wineStyleId}
                  onChange={(event) => onFieldChange('wineStyleId', event.target.value)}
                  disabled={busy}
                >
                  <option value="">No linked wine style</option>
                  {wineStyleOptions.map((wineStyle) => (
                    <option key={wineStyle.id} value={wineStyle.id}>
                      {wineStyle.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Wine name</span>
                <input value={draft.wineName} onChange={(event) => onFieldChange('wineName', event.target.value)} />
              </label>
              <label className="field-block">
                <span>Wine style name</span>
                <input value={draft.wineStyleName} onChange={(event) => onFieldChange('wineStyleName', event.target.value)} />
              </label>
            </div>

            <div className="field-grid">
              <label className="field-block">
                <span>Producer</span>
                <input value={draft.producer} onChange={(event) => onFieldChange('producer', event.target.value)} />
              </label>
              <label className="field-block">
                <span>Vintage</span>
                <input value={draft.vintage} onChange={(event) => onFieldChange('vintage', event.target.value)} />
              </label>
            </div>

            <div className="field-grid field-grid--compact">
              <label className="field-block">
                <span>Tasting date</span>
                <input type="date" value={draft.tastingDate} onChange={(event) => onFieldChange('tastingDate', event.target.value)} />
              </label>
              <label className="field-block">
                <span>Price</span>
                <input value={draft.tastingPrice} onChange={(event) => onFieldChange('tastingPrice', event.target.value)} />
              </label>
            </div>

            <StarRating
              value={draft.tastingRating}
              label="Tasting rating"
              onChange={(value) => onFieldChange('tastingRating', value)}
            />

            <label className="field-block field-block--wine-notes">
              <span>Wine notes</span>
              <AutoGrowTextarea minRows={5} value={draft.wineNotes} onChange={(event) => onFieldChange('wineNotes', event.target.value)} />
            </label>

            <label className="field-block field-block--wine-notes">
              <span>Tasting notes</span>
              <AutoGrowTextarea minRows={5} value={draft.tastingNotes} onChange={(event) => onFieldChange('tastingNotes', event.target.value)} />
            </label>

            <label className="field-block">
              <span>AI confidence</span>
              <AutoGrowTextarea minRows={3} value={draft.confidenceSummary} onChange={(event) => onFieldChange('confidenceSummary', event.target.value)} />
            </label>

            <div className="editor-action-row">
              <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={onCreate} disabled={busy || !draft.regionSlug || !draft.wineName.trim()}>
                {busy ? 'Creating…' : 'Create records'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function AddRegionModal({
  isOpen,
  busy,
  error,
  country,
  name,
  onClose,
  onCountryChange,
  onNameChange,
  onCreate
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fast-add-modal">
      <div className="fast-add-modal__backdrop" onClick={busy ? undefined : onClose} />
      <section className="fast-add-modal__panel">
        <div className="fast-add-modal__header">
          <div>
            <p className="eyebrow">Atlas</p>
            <h2>Add Region</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="editor-card fast-add-form">
          <p>Enter a country and region name. The app will look up the location, infer map framing, and generate atlas notes automatically.</p>
          {error ? <div className="state-card state-card--error">{error}</div> : null}

          <div className="field-grid">
            <label className="field-block">
              <span>Country</span>
              <input value={country} onChange={(event) => onCountryChange(event.target.value)} placeholder="e.g. Portugal" />
            </label>
            <label className="field-block">
              <span>Region name</span>
              <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="e.g. Dao" />
            </label>
          </div>

          <div className="editor-action-row">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={onCreate}
              disabled={busy || !country.trim() || !name.trim()}
            >
              {busy ? 'Adding…' : 'Add region'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function WineEditor({
  region,
  onBackToCountry,
  mode,
  wines,
  wineStyles,
  selectedWine,
  selectedStyle,
  activeTasting,
  draftName,
  draftStyleName,
  loading,
  saving,
  error,
  notice,
  onDraftChange,
  onDraftStyleChange,
  onAddWine,
  onAddWineStyle,
  onDeleteWine,
  onDeleteWineStyle,
  onSelectWine,
  onSelectStyle,
  onBackToWineList,
  onBackToStyleList,
  onOpenTasting,
  onStartNewTasting,
  onBackToWine,
  onDeleteTasting,
  onSetMode,
  onWineFieldChange,
  onGenerateWineNotes,
  onStyleFieldChange,
  onGenerateStyleNotes,
  onFindStyleExamples,
  onTastingFieldChange,
  onUploadTastingImages,
  onUploadWineImage,
  onGenerateWineImage,
  generatingWineNotesId,
  generatingWineImageId,
  generatingStyleNotesId,
  findingStyleExamplesId,
  onClose
}) {
  const tastingUploadInputId =
    selectedWine && activeTasting
      ? `tasting-upload-${selectedWine.id}-${activeTasting.id}`
      : 'tasting-upload';
  const wineUploadInputId = selectedWine ? `wine-upload-${selectedWine.id}` : 'wine-upload';
  const [isChangingWineStyle, setIsChangingWineStyle] = useState(false);
  const confirmAction = (message, action) => {
    if (window.confirm(message)) {
      action();
    }
  };

  useEffect(() => {
    setIsChangingWineStyle(false);
  }, [selectedWine?.id]);

  if (activeTasting && selectedWine) {
    return (
      <section className="editor-panel">
        <div className="editor-panel__header">
          <div>
            <div className="editor-breadcrumbs">
              <button type="button" className="crumb-button" onClick={onBackToCountry}>
                {region.country}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onClose}>
                {region.name}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onBackToWineList}>
                Wines
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onBackToWine}>
                {selectedWine.name || 'Wine'}
              </button>
              <span className="crumb-separator">/</span>
              <span className="crumb-current">
                {activeTasting.isNew ? 'New tasting' : activeTasting.date || 'Tasting'}
              </span>
            </div>
            <p className="eyebrow">Tasting</p>
            <h2>{selectedWine.name}</h2>
          </div>
        </div>

        <div className="editor-card">
          {notice && <div className="state-card">{notice}</div>}
          {error && <div className="state-card state-card--error">{error}</div>}

          <div className="tasting-editor-screen">
            <div className="tasting-grid tasting-grid--compact">
              <label className="field-block field-block--compact">
                <span>Date</span>
                <input
                  type="date"
                  value={activeTasting.date}
                  onChange={(event) =>
                    onTastingFieldChange(selectedWine.id, activeTasting.id, 'date', event.target.value)
                  }
                />
              </label>
              <label className="field-block field-block--compact">
                <span>Price</span>
                <input
                  type="text"
                  value={activeTasting.price}
                  onChange={(event) =>
                    onTastingFieldChange(selectedWine.id, activeTasting.id, 'price', event.target.value)
                  }
                  placeholder="e.g. 28.00 or £42"
                />
              </label>
            </div>

            <StarRating
              value={activeTasting.rating}
              label="Rating"
              onChange={(value) =>
                onTastingFieldChange(selectedWine.id, activeTasting.id, 'rating', value)
              }
            />

            <div className="field-block">
              <span>Images</span>
              <div className="tasting-images tasting-images--grid">
                <label htmlFor={tastingUploadInputId} className="image-upload-tile" aria-label="Add images">
                  <input
                    id={tastingUploadInputId}
                    className="image-upload-panel__input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      if (files.length) {
                        onUploadTastingImages(selectedWine.id, activeTasting.id, files);
                      }
                      event.target.value = '';
                    }}
                  />
                  <span className="image-upload-tile__plus" aria-hidden="true">+</span>
                </label>
                {activeTasting.images.map((imageUrl) => (
                  <a
                    key={imageUrl}
                    href={buildUploadUrl(imageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="tasting-image-link"
                  >
                    <img src={buildUploadUrl(imageUrl)} alt="" className="tasting-image" />
                  </a>
                ))}
              </div>
            </div>

            <label className="field-block">
              <span>Tasting notes</span>
              <textarea
                rows="6"
                value={activeTasting.notes}
                onChange={(event) =>
                  onTastingFieldChange(selectedWine.id, activeTasting.id, 'notes', event.target.value)
                }
                placeholder="What did you think of it?"
              />
              <NoteLinks value={activeTasting.notes} />
            </label>

            <div className="editor-action-row">
              <button type="button" className="secondary-button" onClick={onBackToWine}>
                Back to wine
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={saving}
                onClick={() =>
                  confirmAction('Delete this tasting?', () =>
                    onDeleteTasting(selectedWine.id, activeTasting.id)
                  )
                }
              >
                Delete tasting
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (selectedWine) {
    return (
      <section className="editor-panel">
        <div className="editor-panel__header">
          <div>
            <div className="editor-breadcrumbs">
              <button type="button" className="crumb-button" onClick={onBackToCountry}>
                {region.country}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onClose}>
                {region.name}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onBackToWineList}>
                Wines
              </button>
              <span className="crumb-separator">/</span>
              <span className="crumb-current">{selectedWine.name || 'Wine'}</span>
            </div>
            <p className="eyebrow">Wine</p>
          </div>
        </div>

        <div className="editor-card">
          {error && <div className="state-card state-card--error">{error}</div>}

          <div className="wine-detail-form">
            <div className="wine-hero">
              <div className="wine-hero__media">
                {selectedWine.imageUrl ? (
                  <div className="wine-hero__image-card image-thumb-card image-thumb-card--large">
                    <a
                      href={buildUploadUrl(selectedWine.imageUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="wine-hero__image-link"
                    >
                      <img src={buildUploadUrl(selectedWine.imageUrl)} alt="" className="tasting-image" />
                    </a>
                    <button
                      type="button"
                      className="image-thumb-card__delete"
                      onClick={() =>
                        confirmAction('Remove this wine image?', () =>
                          onWineFieldChange(selectedWine.id, 'imageUrl', '')
                        )
                      }
                      aria-label="Remove wine image"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="wine-hero__upload wine-hero__upload--empty">
                    <span>No image</span>
                  </div>
                )}

                <div className="wine-hero__media-actions">
                  <label
                    htmlFor={wineUploadInputId}
                    className="toolbar-icon-button toolbar-icon-button--secondary"
                    aria-label="Upload wine image"
                    title="Upload wine image"
                  >
                    <input
                      id={wineUploadInputId}
                      className="image-upload-panel__input"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          onUploadWineImage(selectedWine.id, file);
                        }
                        event.target.value = '';
                      }}
                    />
                    <span aria-hidden="true">＋</span>
                  </label>
                  <button
                    type="button"
                    className={`ai-action-button wine-hero__media-ai-button ${generatingWineImageId === selectedWine.id ? 'is-loading' : ''}`}
                    disabled={saving || generatingWineImageId === selectedWine.id || !selectedWine.name.trim()}
                    onClick={() => onGenerateWineImage(selectedWine.id)}
                    aria-label="Generate wine image with AI"
                    title="Generate wine image with AI"
                  >
                    <span className="ai-action-button__icon" aria-hidden="true">
                      {generatingWineImageId === selectedWine.id ? (
                        <img src={AI_LOADING_GIF_URL} alt="" className="ai-action-button__loading-gif" />
                      ) : (
                        <SparkleAiIcon />
                      )}
                    </span>
                  </button>
                </div>
              </div>

              <div className="wine-hero__content">
                <input
                  type="text"
                  className="wine-hero__title-input"
                  value={selectedWine.name}
                  onChange={(event) => onWineFieldChange(selectedWine.id, 'name', event.target.value)}
                  placeholder="Wine name"
                />

                <div className="style-toolbar">
                  <button
                    type="button"
                    className="toolbar-icon-button toolbar-icon-button--secondary"
                    onClick={onClose}
                    aria-label="Back to map"
                    title="Back to map"
                  >
                    <span aria-hidden="true">🌐</span>
                  </button>
                  <button
                    type="button"
                    className="toolbar-icon-button toolbar-icon-button--danger"
                    disabled={saving}
                    onClick={() =>
                      confirmAction('Delete this wine?', () => onDeleteWine(selectedWine.id))
                    }
                    aria-label="Delete wine"
                    title="Delete wine"
                  >
                    <span aria-hidden="true">🗑</span>
                  </button>
                  <div className="wine-toolbar-rating">
                    <span className="wine-toolbar-rating__label">
                      {selectedWine.tastings.length
                        ? `Rating (${selectedWine.tastings.length} tasting${selectedWine.tastings.length === 1 ? '' : 's'})`
                        : 'Rating (no tastings yet)'}
                    </span>
                    <StarRatingInline value={selectedWine.rating} />
                  </div>
                </div>

                <label className="wine-inline-field">
                  <span>Wine style</span>
                  <div className="wine-inline-field__content">
                    {selectedWine.styleId && selectedWine.styleName ? (
                      <button
                        type="button"
                        className="tag-chip tag-chip--button wine-style-pill"
                        onClick={() => onSelectStyle(selectedWine.styleId)}
                      >
                        {selectedWine.styleName}
                      </button>
                    ) : (
                      <span className="wine-inline-field__empty">No linked wine style</span>
                    )}

                    <button
                      type="button"
                      className="secondary-button wine-inline-field__action"
                      onClick={() => setIsChangingWineStyle((current) => !current)}
                    >
                      {selectedWine.styleId ? 'Change' : 'Choose'}
                    </button>
                  </div>
                  {isChangingWineStyle && (
                    <select
                      value={selectedWine.styleId}
                      onChange={(event) => {
                        onWineFieldChange(selectedWine.id, 'styleId', event.target.value);
                        setIsChangingWineStyle(false);
                      }}
                    >
                      <option value="">No linked wine style</option>
                      {wineStyles.map((wineStyle) => (
                        <option key={wineStyle.id} value={wineStyle.id}>
                          {wineStyle.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                <label className="field-block field-block--wine-notes">
                  <div className="field-block__header">
                    <span>Notes</span>
                    <button
                      type="button"
                      className={`ai-action-button ${generatingWineNotesId === selectedWine.id ? 'is-loading' : ''}`}
                      disabled={saving || generatingWineNotesId === selectedWine.id || !selectedWine.name.trim()}
                      onClick={() => onGenerateWineNotes(selectedWine.id)}
                      aria-label="Generate notes with AI"
                      title="Generate notes with AI"
                    >
                      <span className="ai-action-button__icon" aria-hidden="true">
                        {generatingWineNotesId === selectedWine.id ? (
                          <img src={AI_LOADING_GIF_URL} alt="" className="ai-action-button__loading-gif" />
                        ) : (
                          <SparkleAiIcon />
                        )}
                      </span>
                    </button>
                  </div>
                  <AutoGrowTextarea
                    minRows={7}
                    value={selectedWine.notes}
                    onChange={(event) => onWineFieldChange(selectedWine.id, 'notes', event.target.value)}
                    placeholder="Add notes about this wine"
                  />
                  <NoteLinks value={selectedWine.notes} />
                </label>
              </div>
            </div>
          </div>

          <div className="tasting-section">
            <div className="tasting-section__header">
              <h3>Tastings</h3>
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={() => onStartNewTasting(selectedWine.id)}
              >
                Add tasting
              </button>
            </div>

            <div className="tasting-card-grid">
              {selectedWine.tastings.length ? (
                selectedWine.tastings.map((tasting) => (
                  <button
                    key={tasting.id}
                    type="button"
                    className="tasting-summary-card"
                    onClick={() => onOpenTasting(selectedWine.id, tasting.id)}
                  >
                    <div className="tasting-summary-card__thumb">
                      {tasting.images[0] ? (
                        <img
                          src={buildUploadUrl(tasting.images[0])}
                          alt=""
                          className="tasting-image"
                        />
                      ) : (
                        <span>No image</span>
                      )}
                    </div>
                    <div className="tasting-summary-card__body">
                      <strong>{tasting.date || 'Undated tasting'}</strong>
                      <div className="tasting-summary-card__rating">
                        <StarRatingInline value={tasting.rating} />
                      </div>
                      <p>{summarizeNotes(tasting.notes, 250)}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="state-card">No tastings recorded yet for this wine.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (selectedStyle) {
    const relatedWines = wines.filter((wine) => wine.styleId === selectedStyle.id);

    return (
      <section className="editor-panel">
        <div className="editor-panel__header">
          <div>
            <div className="editor-breadcrumbs">
              <button type="button" className="crumb-button" onClick={onBackToCountry}>
                {region.country}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onClose}>
                {region.name}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onBackToStyleList}>
                Wine Styles
              </button>
              <span className="crumb-separator">/</span>
              <span className="crumb-current">{selectedStyle.name || 'Wine style'}</span>
            </div>
            <p className="eyebrow">Wine Style</p>
          </div>
        </div>

        <div className="editor-card">
          {error && <div className="state-card state-card--error">{error}</div>}

          <div className="style-detail-form">
            <input
              type="text"
              className="wine-hero__title-input"
              value={selectedStyle.name}
              onChange={(event) => onStyleFieldChange(selectedStyle.id, 'name', event.target.value)}
              placeholder="Wine style name"
            />

            <div className="style-toolbar">
              <button
                type="button"
                className="toolbar-icon-button toolbar-icon-button--secondary"
                onClick={onClose}
                aria-label="Back to map"
                title="Back to map"
              >
                <span aria-hidden="true">🌐</span>
              </button>
              <button
                type="button"
                className="toolbar-icon-button toolbar-icon-button--danger"
                disabled={saving}
                onClick={() =>
                  confirmAction('Delete this wine style?', () => onDeleteWineStyle(selectedStyle.id))
                }
                aria-label="Delete wine style"
                title="Delete wine style"
              >
                <span aria-hidden="true">🗑</span>
              </button>
            </div>

            <label className="field-block field-block--style-notes">
              <div className="field-block__header">
                <span>Notes</span>
                <button
                  type="button"
                  className={`ai-action-button ${generatingStyleNotesId === selectedStyle.id ? 'is-loading' : ''}`}
                  disabled={saving || generatingStyleNotesId === selectedStyle.id || !selectedStyle.name.trim()}
                  onClick={() => onGenerateStyleNotes(selectedStyle.id)}
                  aria-label="Generate notes with AI"
                  title="Generate notes with AI"
                >
                  <span className="ai-action-button__icon" aria-hidden="true">
                    {generatingStyleNotesId === selectedStyle.id ? (
                      <img src={AI_LOADING_GIF_URL} alt="" className="ai-action-button__loading-gif" />
                    ) : (
                      <SparkleAiIcon />
                    )}
                  </span>
                </button>
              </div>
              <AutoGrowTextarea
                minRows={8}
                value={selectedStyle.notes}
                onChange={(event) => onStyleFieldChange(selectedStyle.id, 'notes', event.target.value)}
                placeholder="Add notes about this wine style"
              />
              <NoteLinks value={selectedStyle.notes} />
            </label>

            <div className="tasting-section">
              <div className="tasting-section__header">
                <h3>Examples</h3>
                <button
                  type="button"
                  className={`ai-action-button ${findingStyleExamplesId === selectedStyle.id ? 'is-loading' : ''}`}
                  disabled={saving || findingStyleExamplesId === selectedStyle.id || !selectedStyle.name.trim()}
                  onClick={() => onFindStyleExamples(selectedStyle.id)}
                  aria-label="Find examples with AI"
                  title="Find examples with AI"
                >
                  <span className="ai-action-button__icon" aria-hidden="true">
                    {findingStyleExamplesId === selectedStyle.id ? (
                      <img src={AI_LOADING_GIF_URL} alt="" className="ai-action-button__loading-gif" />
                    ) : (
                      <SparkleAiIcon />
                    )}
                  </span>
                </button>
              </div>

              <div className="wine-summary-list">
                {relatedWines.length ? (
                  relatedWines.map((wine) => (
                    <button
                      key={wine.id}
                      type="button"
                      className="wine-summary-card"
                      onClick={() => onSelectWine(wine.id, selectedStyle.id)}
                    >
                      <div className="wine-summary-card__thumb">
                        {wine.imageUrl ? (
                          <img
                            src={buildUploadUrl(wine.imageUrl)}
                            alt=""
                            className="tasting-image"
                          />
                        ) : (
                          <span>No image</span>
                        )}
                      </div>
                      <div className="wine-summary-card__body">
                        <div className="wine-summary-card__topline">
                          <strong>{wine.name}</strong>
                          <span>{wine.tastings.length} tasting{wine.tastings.length === 1 ? '' : 's'}</span>
                        </div>
                        <div className="wine-summary-card__rating">
                          <StarRatingInline value={wine.rating} />
                        </div>
                        <p>{summarizeNotes(wine.notes, 100)}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="state-card">No linked wines yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
      <section className="editor-panel">
        <div className="editor-panel__header">
          <div>
            <div className="editor-breadcrumbs">
              <button type="button" className="crumb-button" onClick={onBackToCountry}>
                {region.country}
              </button>
              <span className="crumb-separator">/</span>
              <button type="button" className="crumb-button" onClick={onClose}>
                {region.name}
              </button>
              <span className="crumb-separator">/</span>
              <span className="crumb-current">{mode === 'styles' ? 'Wine Styles' : 'Wines'}</span>
            </div>
          <h2>{mode === 'styles' ? `${region.name} Wine Styles` : `${region.name} Wines`}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Back to map
        </button>
      </div>

      <div className="editor-card">
        <form
          className="wine-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === 'styles') {
              onAddWineStyle();
              return;
            }
            onAddWine();
          }}
        >
          <input
            type="text"
            value={mode === 'styles' ? draftStyleName : draftName}
            onChange={(event) => {
              if (mode === 'styles') {
                onDraftStyleChange(event.target.value);
                return;
              }
              onDraftChange(event.target.value);
            }}
            placeholder={mode === 'styles' ? 'Add a wine style' : 'Add a wine'}
          />
          <button
            type="submit"
            className="primary-button"
            disabled={!(mode === 'styles' ? draftStyleName.trim() : draftName.trim())}
          >
            {mode === 'styles' ? 'Add wine style' : 'Add wine'}
          </button>
        </form>

        {loading && <div className="state-card">Loading wines…</div>}
        {!loading && error && <div className="state-card state-card--error">{error}</div>}

        {!loading && !error && (
          mode === 'styles' ? (
            <div className="wine-summary-list">
              {wineStyles.length ? (
                wineStyles.map((wineStyle) => {
                  const linkedWineCount = wines.filter((wine) => wine.styleId === wineStyle.id).length;

                  return (
                    <button
                      key={wineStyle.id}
                      type="button"
                      className="style-summary-card"
                      onClick={() => onSelectStyle(wineStyle.id)}
                    >
                      <div className="wine-summary-card__topline">
                        <strong>{wineStyle.name}</strong>
                        <span>{linkedWineCount} wine{linkedWineCount === 1 ? '' : 's'}</span>
                      </div>
                      <p>{summarizeNotes(wineStyle.notes, 100)}</p>
                    </button>
                  );
                })
              ) : (
                <div className="state-card">No wine styles yet for this region.</div>
              )}
            </div>
          ) : (
            <div className="wine-summary-list">
              {wines.length ? (
                wines.map((wine) => (
                  <button
                    key={wine.id}
                    type="button"
                    className="wine-summary-card"
                    onClick={() => onSelectWine(wine.id)}
                  >
                    <div className="wine-summary-card__thumb">
                      {wine.imageUrl ? (
                        <img
                          src={buildUploadUrl(wine.imageUrl)}
                          alt=""
                          className="tasting-image"
                        />
                      ) : (
                        <span>No image</span>
                      )}
                    </div>
                    <div className="wine-summary-card__body">
                      <div className="wine-summary-card__topline">
                        <strong>{wine.name}</strong>
                        <span>{wine.tastings.length} tasting{wine.tastings.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="wine-summary-card__rating">
                        <StarRatingInline value={wine.rating} />
                      </div>
                      <p>{wine.styleName ? `${wine.styleName} · ${summarizeNotes(wine.notes, 80)}` : summarizeNotes(wine.notes, 100)}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="state-card">No wines yet for this region.</div>
              )}
            </div>
          )
        )}
      </div>
    </section>
  );
}

function App() {
  const initialRouteRef = useRef(parseLocationRoute(window.location.search));
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const hoverPopupRef = useRef(null);
  const suppressCountryClickUntilRef = useRef(0);
  const regionsRef = useRef([]);
  const countryFeaturesRef = useRef({});
  const pendingWorldResetRef = useRef([]);
  const markerRefs = useRef([]);
  const tastingAutosaveTimerRef = useRef(null);
  const tastingAutosaveSnapshotRef = useRef({});
  const wineAutosaveTimerRef = useRef(null);
  const wineAutosaveSnapshotRef = useRef({});
  const wineStyleAutosaveTimerRef = useRef(null);
  const wineStyleAutosaveSnapshotRef = useRef({});
  const [pendingRoute, setPendingRoute] = useState(
    initialRouteRef.current.editor ? initialRouteRef.current : null
  );
  const isApplyingHistoryRouteRef = useRef(false);
  const hasInitializedHistoryRef = useRef(false);
  const lastHistorySearchRef = useRef(buildRouteSearch(initialRouteRef.current));
  const shouldReplaceNextHistoryRef = useRef(false);
  const [regions, setRegions] = useState([]);
  const [filters, setFilters] = useState({ countries: [], styles: [] });
  const [country, setCountry] = useState(initialRouteRef.current.country);
  const [selectedSlug, setSelectedSlug] = useState(initialRouteRef.current.region);
  const [hoveredCountry, setHoveredCountry] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [isEditingWines, setIsEditingWines] = useState(Boolean(initialRouteRef.current.editor));
  const [editorMode, setEditorMode] = useState(initialRouteRef.current.editor || 'wines');
  const [editorWines, setEditorWines] = useState([]);
  const [editorWineStyles, setEditorWineStyles] = useState([]);
  const [editorDraftName, setEditorDraftName] = useState('');
  const [editorStyleDraftName, setEditorStyleDraftName] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorGeneratingWineId, setEditorGeneratingWineId] = useState('');
  const [editorGeneratingWineImageId, setEditorGeneratingWineImageId] = useState('');
  const [editorGeneratingStyleId, setEditorGeneratingStyleId] = useState('');
  const [editorFindingStyleExamplesId, setEditorFindingStyleExamplesId] = useState('');
  const [editorError, setEditorError] = useState('');
  const [editorNotice, setEditorNotice] = useState('');
  const [editorSelectedWineId, setEditorSelectedWineId] = useState(null);
  const [editorSelectedStyleId, setEditorSelectedStyleId] = useState(null);
  const [editorParentStyleId, setEditorParentStyleId] = useState(
    initialRouteRef.current.editor === 'wines' ? initialRouteRef.current.styleId : null
  );
  const [editorActiveTastingId, setEditorActiveTastingId] = useState(null);
  const [isFastAddOpen, setIsFastAddOpen] = useState(false);
  const [fastAddStage, setFastAddStage] = useState('upload');
  const [fastAddBusy, setFastAddBusy] = useState(false);
  const [fastAddError, setFastAddError] = useState('');
  const [fastAddDraft, setFastAddDraft] = useState(normalizeFastAddDraft());
  const [fastAddRegionOptions, setFastAddRegionOptions] = useState([]);
  const [fastAddWineStyleOptions, setFastAddWineStyleOptions] = useState([]);
  const [isAddRegionOpen, setIsAddRegionOpen] = useState(false);
  const [addRegionBusy, setAddRegionBusy] = useState(false);
  const [addRegionError, setAddRegionError] = useState('');
  const [addRegionCountry, setAddRegionCountry] = useState('');
  const [addRegionName, setAddRegionName] = useState('');

  const selectedRegion = useMemo(
    () => regions.find((region) => region.slug === selectedSlug) || null,
    [regions, selectedSlug]
  );
  const selectedEditorWine = useMemo(
    () => editorWines.find((wine) => wine.id === editorSelectedWineId) || null,
    [editorSelectedWineId, editorWines]
  );
  const selectedEditorStyle = useMemo(
    () => editorWineStyles.find((wineStyle) => wineStyle.id === editorSelectedStyleId) || null,
    [editorSelectedStyleId, editorWineStyles]
  );
  const selectedEditorTasting = useMemo(
    () => selectedEditorWine?.tastings.find((tasting) => tasting.id === editorActiveTastingId) || null,
    [editorActiveTastingId, selectedEditorWine]
  );
  const isWorldHome = country === 'All' && !selectedRegion;
  const isMapVisible = !isEditingWines;

  const applyHistoryRoute = useCallback((route) => {
    const normalizedRoute = normalizeRouteState(route);

    setPendingRoute(normalizedRoute.editor ? normalizedRoute : null);
    lastHistorySearchRef.current = buildRouteSearch(normalizedRoute);
    isApplyingHistoryRouteRef.current = true;

    setHoveredCountry('');
    setCountry(normalizedRoute.country);
    setSelectedSlug(normalizedRoute.region);
    setIsEditingWines(Boolean(normalizedRoute.editor));
    setEditorMode(normalizedRoute.editor || 'wines');
    setEditorSelectedWineId(null);
    setEditorSelectedStyleId(null);
    setEditorParentStyleId(normalizedRoute.editor === 'wines' ? normalizedRoute.styleId : null);
    setEditorActiveTastingId(null);

    if (!normalizedRoute.editor) {
      window.setTimeout(() => {
        isApplyingHistoryRouteRef.current = false;
      }, 0);
    }
  }, []);

  const fetchRegionsForCountry = useCallback(async (targetCountry = country) => {
    try {
      setLoading(true);
      setError('');
      const params = {};

      if (targetCountry !== 'All') {
        params.country = targetCountry;
      }

      const response = await axios.get('/api/regions', { params });
      setRegions(response.data.regions);
      setFilters(response.data.filters);
      return response.data;
    } catch (requestError) {
      setError('Could not load wine regions.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [country]);

  const loadRegions = useCallback(async () => {
    await fetchRegionsForCountry(country);
  }, [country, fetchRegionsForCountry]);

  const loadEditorData = useCallback(async (regionSlug) => {
    try {
      setEditorLoading(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.get(`/api/regions/${regionSlug}/wines`);
      const normalizedWines = (response.data.wines || []).map(normalizeEditorWine);
      const normalizedWineStyles = (response.data.wineStyles || []).map(normalizeEditorWineStyle);
      setEditorWines(normalizedWines);
      setEditorWineStyles(normalizedWineStyles);
      return { wines: normalizedWines, wineStyles: normalizedWineStyles };
    } catch (requestError) {
      setEditorError('Could not load wines for this region.');
      return { wines: [], wineStyles: [] };
    } finally {
      setEditorLoading(false);
    }
  }, []);

  const resetFastAdd = useCallback(() => {
    setFastAddStage('upload');
    setFastAddBusy(false);
    setFastAddError('');
    setFastAddDraft(normalizeFastAddDraft());
    setFastAddWineStyleOptions([]);
  }, []);

  const handleOpenFastAdd = useCallback(() => {
    setFastAddRegionOptions(
      regions.map((region) => ({
        slug: region.slug,
        name: region.name,
        country: region.country
      }))
    );
    setIsFastAddOpen(true);
    resetFastAdd();
  }, [regions, resetFastAdd]);

  const handleCloseFastAdd = useCallback(() => {
    if (fastAddBusy) {
      return;
    }

    setIsFastAddOpen(false);
    resetFastAdd();
  }, [fastAddBusy, resetFastAdd]);

  const handleFastAddFieldChange = useCallback((field, value) => {
    setFastAddDraft((current) => {
      const nextDraft = { ...current, [field]: value };

      if (field === 'wineStyleId' && value) {
        const matchingStyle = fastAddWineStyleOptions.find((wineStyle) => String(wineStyle.id) === String(value));
        if (matchingStyle) {
          nextDraft.wineStyleName = matchingStyle.name;
        }
      }

      return nextDraft;
    });
  }, [fastAddWineStyleOptions]);

  const handleFastAddRegionChange = useCallback(async (regionSlug) => {
    setFastAddDraft((current) => ({
      ...current,
      regionSlug,
      wineStyleId: '',
      wineStyleName: current.wineStyleId ? '' : current.wineStyleName
    }));

    if (!regionSlug) {
      setFastAddWineStyleOptions([]);
      return;
    }

    const matchingRegion = regions.find((region) => region.slug === regionSlug);
    if (matchingRegion) {
      setFastAddDraft((current) => ({
        ...current,
        regionSlug,
        regionName: matchingRegion.name,
        countryName: matchingRegion.country,
        wineStyleId: ''
      }));
    }

    try {
      const response = await axios.get(`/api/regions/${regionSlug}/wine-styles`);
      setFastAddWineStyleOptions(response.data?.wineStyles || []);
    } catch (requestError) {
      setFastAddWineStyleOptions([]);
    }
  }, [regions]);

  const handleAnalyzeFastAdd = useCallback(async (files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));

    try {
      setFastAddBusy(true);
      setFastAddError('');
      const response = await axios.post('/api/fast-add/analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setFastAddDraft(normalizeFastAddDraft(response.data?.proposal || {}));
      setFastAddRegionOptions(response.data?.options?.regions || []);
      setFastAddWineStyleOptions(response.data?.options?.wineStyles || []);
      setFastAddStage('review');
    } catch (requestError) {
      setFastAddError(requestError.response?.data?.error || 'Could not analyze these label photos.');
    } finally {
      setFastAddBusy(false);
    }
  }, []);

  const handleCreateFastAdd = useCallback(async () => {
    try {
      setFastAddBusy(true);
      setFastAddError('');
      const response = await axios.post('/api/fast-add/create', fastAddDraft);
      const region = response.data?.region;
      const wine = response.data?.wine;
      const tastingId = response.data?.tastingId || null;

      if (!region?.slug || !wine?.id) {
        throw new Error('Missing created record details.');
      }

      await fetchRegionsForCountry(region.country);
      const { wines, wineStyles } = await loadEditorData(region.slug);
      const createdWine = wines.find((entry) => String(entry.id) === String(wine.id)) || normalizeEditorWine(wine);

      setCountry(region.country);
      setSelectedSlug(region.slug);
      setIsEditingWines(true);
      setEditorMode('wines');
      setEditorSelectedStyleId('');
      setEditorParentStyleId(createdWine.styleId || null);
      setEditorSelectedWineId(createdWine.id);
      setEditorActiveTastingId(tastingId);
      setEditorWines(wines);
      setEditorWineStyles(wineStyles);
      setIsFastAddOpen(false);
      resetFastAdd();
    } catch (requestError) {
      setFastAddError(requestError.response?.data?.error || requestError.message || 'Could not create records from this proposal.');
    } finally {
      setFastAddBusy(false);
    }
  }, [fastAddDraft, fetchRegionsForCountry, loadEditorData, resetFastAdd]);

  const handleOpenAddRegion = useCallback(() => {
    setAddRegionCountry(country !== 'All' ? country : '');
    setAddRegionName('');
    setAddRegionError('');
    setIsAddRegionOpen(true);
  }, [country]);

  const handleCloseAddRegion = useCallback(() => {
    if (addRegionBusy) {
      return;
    }

    setIsAddRegionOpen(false);
    setAddRegionError('');
  }, [addRegionBusy]);

  const handleCreateRegion = useCallback(async () => {
    try {
      setAddRegionBusy(true);
      setAddRegionError('');
      const response = await axios.post('/api/regions/add-generated', {
        country: addRegionCountry.trim(),
        name: addRegionName.trim()
      });
      const region = response.data?.region;

      if (!region?.slug) {
        throw new Error('Region creation did not return a region.');
      }

      setCountry(region.country);
      await fetchRegionsForCountry(region.country);
      setSelectedSlug(region.slug);
      setIsEditingWines(false);
      setIsAddRegionOpen(false);
      setAddRegionName('');
    } catch (requestError) {
      setAddRegionError(requestError.response?.data?.error || requestError.message || 'Could not add this region.');
    } finally {
      setAddRegionBusy(false);
    }
  }, [addRegionCountry, addRegionName, fetchRegionsForCountry]);

  const handleGoHome = () => {
    setCountry('All');
    setSelectedSlug(null);
    setHoveredCountry('');
    setIsEditingWines(false);

    if (mapRef.current) {
      pendingWorldResetRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingWorldResetRef.current = [];
      animateWorldView(mapRef.current);
    }
  };

  const handleBackToCountry = () => {
    setSelectedSlug(null);
    setIsEditingWines(false);

    if (mapRef.current && country !== 'All') {
      const countryFeature = countryFeaturesRef.current[country];

      if (countryFeature) {
        const countryRegions = regionsRef.current.filter((region) => region.country === country);
        const focusGeometry = getCountryFocusGeometry(countryFeature, countryRegions);

        mapRef.current.fitBounds(
          getFeatureBounds(window.maplibregl, { ...countryFeature, geometry: focusGeometry }),
          {
            padding: 42,
            duration: 800
          }
        );
      }
    }
  };

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    async function run() {
      await loadRegions();
    }

    run();
  }, [loadRegions]);

  useEffect(() => {
    if (!selectedRegion && !selectedSlug) {
      setIsEditingWines(false);
      setEditorWines([]);
      setEditorWineStyles([]);
      setEditorDraftName('');
      setEditorStyleDraftName('');
      setEditorError('');
      setEditorMode('wines');
      setEditorSelectedWineId(null);
      setEditorSelectedStyleId(null);
      setEditorParentStyleId(null);
      setEditorActiveTastingId(null);
    }
  }, [selectedRegion, selectedSlug]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!regions.length) {
      setSelectedSlug(null);
      return;
    }

    if (selectedSlug && !regions.some((region) => region.slug === selectedSlug)) {
      setSelectedSlug(null);
    }
  }, [loading, regions, selectedSlug]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current || !window.maplibregl) {
      return undefined;
    }

    const map = new window.maplibregl.Map({
      container: mapNodeRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 0.6,
      minZoom: 0.4,
      renderWorldCopies: false
    });

    map.addControl(new window.maplibregl.NavigationControl(), 'top-right');
    map.addControl(new window.maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

    const clearPendingWorldResets = () => {
      pendingWorldResetRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingWorldResetRef.current = [];
    };

    const scheduleInitialWorldReset = () => {
      clearPendingWorldResets();
      pendingWorldResetRef.current = [
        window.setTimeout(() => {
          enforceWorldView(map);
          pendingWorldResetRef.current = [];
        }, 120)
      ];
    };

    map.on('load', () => {
      map.addSource('wine-regions', {
        type: 'geojson',
        data: buildGeoJson([])
      });

      map.addSource('wine-countries', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      map.addLayer({
        id: 'wine-country-fill',
        type: 'fill',
        source: 'wine-countries',
        paint: {
          'fill-color': '#f97316',
          'fill-opacity': 0
        }
      });

      map.addLayer({
        id: 'wine-country-highlight',
        type: 'fill',
        source: 'wine-countries',
        filter: ['==', ['get', 'countryName'], ''],
        paint: {
          'fill-color': '#fb923c',
          'fill-opacity': 0.18
        }
      });

      map.addLayer({
        id: 'wine-country-outline',
        type: 'line',
        source: 'wine-countries',
        filter: ['==', ['get', 'countryName'], ''],
        paint: {
          'line-color': '#9a3412',
          'line-width': 2,
          'line-opacity': 0.9
        }
      });

      map.addLayer({
        id: 'wine-region-glow',
        type: 'circle',
        source: 'wine-regions',
        paint: {
          'circle-radius': 18,
          'circle-color': '#f97316',
          'circle-opacity': 0.18,
          'circle-blur': 0.8
        }
      });

      map.addLayer({
        id: 'wine-region-selected',
        type: 'circle',
        source: 'wine-regions',
        filter: ['==', ['get', 'slug'], ''],
        paint: {
          'circle-radius': 13,
          'circle-color': '#fb923c',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#fff7ed'
        }
      });

      map.on('mousemove', 'wine-country-fill', (event) => {
        const feature = event.features?.[0];
        setHoveredCountry(feature?.properties?.countryName || '');
        map.getCanvas().style.cursor = feature ? 'pointer' : '';
      });

      map.on('mouseleave', 'wine-country-fill', () => {
        setHoveredCountry('');
        map.getCanvas().style.cursor = '';
      });

      map.on('click', 'wine-country-fill', (event) => {
        if (Date.now() < suppressCountryClickUntilRef.current) {
          return;
        }

        const feature = event.features?.[0];
        const clickedCountry = feature?.properties?.countryName;

        if (!feature || !clickedCountry) {
          return;
        }

        const countryRegions = regionsRef.current.filter((region) => region.country === clickedCountry);
        const focusGeometry = getCountryFocusGeometry(feature, countryRegions);

        clearPendingWorldResets();
        setCountry(clickedCountry);
        setSelectedSlug(null);
        map.fitBounds(getFeatureBounds(window.maplibregl, { ...feature, geometry: focusGeometry }), {
          padding: 42,
          duration: 800
        });
      });

      map.once('idle', () => {
        scheduleInitialWorldReset();
      });
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      setMapReady(false);
      clearPendingWorldResets();
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
      }
      if (popupRef.current) {
        popupRef.current.remove();
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource('wine-regions')) {
      return;
    }

    map.getSource('wine-regions').setData(buildGeoJson(regions));
  }, [mapReady, regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !window.maplibregl) {
      return;
    }

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    regions.forEach((region) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'wine-marker';
      element.setAttribute('aria-label', region.name);
      element.innerHTML = WINE_BOTTLE_ICON_SVG;

      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        suppressCountryClickUntilRef.current = Date.now() + 500;
        setCountry(region.country);
        setSelectedSlug(region.slug);
      });

      element.addEventListener('mouseenter', () => {
        if (!hoverPopupRef.current) {
          hoverPopupRef.current = new window.maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 16,
            className: 'wine-hover-popup'
          });
        }

        hoverPopupRef.current
          .setLngLat(region.coordinates)
          .setHTML(`<div class="wine-hover-popup-card">${region.name}</div>`)
          .addTo(map);
      });

      element.addEventListener('mouseleave', () => {
        if (hoverPopupRef.current) {
          hoverPopupRef.current.remove();
        }
      });

      const marker = new window.maplibregl.Marker({
        element,
        anchor: 'bottom'
      })
        .setLngLat(region.coordinates)
        .addTo(map);

      markerRefs.current.push(marker);
    });

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
    };
  }, [mapReady, regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !filters.countries.length || !map.getSource('wine-countries')) {
      return;
    }

    let ignore = false;

    async function loadCountryShapes() {
      try {
        const response = await axios.get(COUNTRIES_GEOJSON_URL);
        if (ignore) {
          return;
        }

        const allowedCountries = new Set(filters.countries);
        const countryGeoJson = buildCountryGeoJson(response.data.features || [], allowedCountries);
        countryFeaturesRef.current = Object.fromEntries(
          countryGeoJson.features.map((feature) => [feature.properties.countryName, feature])
        );
        map.getSource('wine-countries').setData(countryGeoJson);
      } catch (countryError) {
        console.error('Could not load country boundaries', countryError);
      }
    }

    loadCountryShapes();

    return () => {
      ignore = true;
    };
  }, [filters.countries, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    const activeCountry = hoveredCountry || (country !== 'All' ? country : '');
    if (map.getLayer('wine-country-highlight')) {
      map.setFilter('wine-country-highlight', ['==', ['get', 'countryName'], activeCountry]);
    }
    if (map.getLayer('wine-country-outline')) {
      map.setFilter('wine-country-outline', ['==', ['get', 'countryName'], activeCountry]);
    }
  }, [country, hoveredCountry, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    if (map.getLayer('wine-region-selected')) {
      map.setFilter(
        'wine-region-selected',
        ['==', ['get', 'slug'], selectedRegion?.slug || '']
      );
    }

    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    if (!selectedRegion || isEditingWines) {
      if (country === 'All') {
        animateWorldView(map);
      }
      return;
    }

    map.flyTo({
      center: selectedRegion.coordinates,
      zoom: selectedRegion.zoom || 5.5,
      speed: 1.35,
      curve: 1.05,
      essential: true
    });
  }, [country, isEditingWines, mapReady, selectedRegion]);

  useEffect(() => {
    if (!pendingRoute?.editor || !selectedRegion || selectedRegion.slug !== pendingRoute.region) {
      return undefined;
    }

    let ignore = false;

    async function applyPendingEditorRoute() {
      const { wines, wineStyles } = await loadEditorData(selectedRegion.slug);

      if (ignore) {
        return;
      }

      setEditorMode(pendingRoute.editor || 'wines');

      if (pendingRoute.editor === 'styles') {
        const matchingStyle = wineStyles.find((wineStyle) => String(wineStyle.id) === String(pendingRoute.styleId || ''));
        setEditorSelectedStyleId(matchingStyle?.id || null);
        setEditorSelectedWineId(null);
        setEditorParentStyleId(null);
        setEditorActiveTastingId(null);
      } else {
        const matchingWine = wines.find((wine) => String(wine.id) === String(pendingRoute.wineId || ''));
        setEditorSelectedWineId(matchingWine?.id || null);
        setEditorSelectedStyleId(null);
        setEditorParentStyleId(pendingRoute.styleId || null);

        if (matchingWine && pendingRoute.tastingId) {
          const matchingTasting = matchingWine.tastings.find(
            (tasting) => String(tasting.id) === String(pendingRoute.tastingId)
          );
          setEditorActiveTastingId(matchingTasting?.id || null);
        } else {
          setEditorActiveTastingId(null);
        }
      }

      setPendingRoute(null);
      isApplyingHistoryRouteRef.current = false;
    }

    applyPendingEditorRoute();

    return () => {
      ignore = true;
    };
  }, [loadEditorData, pendingRoute, selectedRegion]);

  useEffect(() => {
    const handlePopState = () => {
      const parsedRoute = parseLocationRoute(window.location.search);

      if (
        parsedRoute.editor === 'styles' &&
        !parsedRoute.styleId &&
        editorMode === 'wines' &&
        editorSelectedWineId &&
        editorParentStyleId &&
        parsedRoute.region === selectedSlug
      ) {
        const restoredRoute = {
          ...parsedRoute,
          styleId: editorParentStyleId
        };
        window.history.replaceState({}, '', `${window.location.pathname}${buildRouteSearch(restoredRoute)}`);
        applyHistoryRoute(restoredRoute);
        return;
      }

      applyHistoryRoute(parsedRoute);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [applyHistoryRoute, editorMode, editorParentStyleId, editorSelectedWineId, selectedSlug]);

  useEffect(() => {
    const nextRoute = normalizeRouteState({
      country: selectedRegion?.country || country,
      region: selectedSlug,
      editor: isEditingWines ? editorMode : null,
      wineId: isEditingWines && editorMode === 'wines' ? editorSelectedWineId : null,
      styleId: isEditingWines
        ? (editorMode === 'styles' ? editorSelectedStyleId : editorParentStyleId)
        : null,
      tastingId:
        isEditingWines && editorMode === 'wines' && editorSelectedWineId
          ? editorActiveTastingId
          : null
    });
    const nextSearch = buildRouteSearch(nextRoute);

    if (isApplyingHistoryRouteRef.current) {
      return;
    }

    if (!hasInitializedHistoryRef.current) {
      hasInitializedHistoryRef.current = true;
      lastHistorySearchRef.current = nextSearch;

      if (window.location.search !== nextSearch) {
        window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
      }
      return;
    }

    if (nextSearch !== lastHistorySearchRef.current) {
      if (shouldReplaceNextHistoryRef.current) {
        window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
        shouldReplaceNextHistoryRef.current = false;
      } else {
        window.history.pushState({}, '', `${window.location.pathname}${nextSearch}`);
      }
      lastHistorySearchRef.current = nextSearch;
    }
  }, [
    country,
    editorActiveTastingId,
    editorMode,
    editorParentStyleId,
    editorSelectedStyleId,
    editorSelectedWineId,
    isEditingWines,
    selectedRegion,
    selectedSlug
  ]);

  const handleOpenWineEditor = async (targetWineName = '') => {
    if (!selectedRegion) {
      return;
    }

    setIsEditingWines(true);
    setEditorMode('wines');
    setEditorSelectedWineId(null);
    setEditorSelectedStyleId(null);
    setEditorParentStyleId(null);
    setEditorActiveTastingId(null);
    const { wines } = await loadEditorData(selectedRegion.slug);

    if (targetWineName) {
      const normalizedTarget = String(targetWineName).trim().toLowerCase();
      const matchingWine = wines.find(
        (wine) => String(wine.name || '').trim().toLowerCase() === normalizedTarget
      );

      if (matchingWine) {
        shouldReplaceNextHistoryRef.current = true;
        setEditorSelectedWineId(matchingWine.id);
      }
    }
  };

  const handleOpenWineStyleEditor = async (targetStyleName = '') => {
    if (!selectedRegion) {
      return;
    }

    setIsEditingWines(true);
    setEditorMode('styles');
    setEditorSelectedWineId(null);
    setEditorSelectedStyleId(null);
    setEditorParentStyleId(null);
    setEditorActiveTastingId(null);
    const { wineStyles } = await loadEditorData(selectedRegion.slug);

    if (targetStyleName) {
      const normalizedTarget = String(targetStyleName).trim().toLowerCase();
      const matchingStyle = wineStyles.find(
        (wineStyle) => String(wineStyle.name || '').trim().toLowerCase() === normalizedTarget
      );

      if (matchingStyle) {
        shouldReplaceNextHistoryRef.current = true;
        setEditorSelectedStyleId(matchingStyle.id);
      }
    }
  };

  const handleCloseWineEditor = () => {
    setIsEditingWines(false);
    setEditorError('');
    setEditorNotice('');
    setEditorDraftName('');
    setEditorStyleDraftName('');
    setEditorSelectedWineId(null);
    setEditorSelectedStyleId(null);
    setEditorParentStyleId(null);
    setEditorActiveTastingId(null);
  };

  const handleSelectWine = (wineId, sourceStyleId = null) => {
    if (sourceStyleId && selectedRegion) {
      const styleRouteSearch = buildRouteSearch({
        country: selectedRegion.country || country,
        region: selectedRegion.slug,
        editor: 'styles',
        styleId: sourceStyleId
      });

      if (window.location.search !== styleRouteSearch) {
        window.history.pushState({}, '', `${window.location.pathname}${styleRouteSearch}`);
        lastHistorySearchRef.current = styleRouteSearch;
        hasInitializedHistoryRef.current = true;
      }
    }

    shouldReplaceNextHistoryRef.current = false;
    setEditorMode('wines');
    setEditorSelectedWineId(wineId);
    setEditorSelectedStyleId(null);
    setEditorParentStyleId(sourceStyleId || (editorMode === 'styles' ? editorSelectedStyleId : null));
    setEditorActiveTastingId(null);
  };

  const handleSelectStyle = (styleId) => {
    setEditorMode('styles');
    setEditorSelectedStyleId(styleId);
    setEditorSelectedWineId(null);
    setEditorParentStyleId(null);
    setEditorActiveTastingId(null);
  };

  const handleBackToWineList = () => {
    setEditorSelectedWineId(null);
    setEditorParentStyleId(null);
    setEditorActiveTastingId(null);
  };

  const handleBackToStyleList = () => {
    setEditorSelectedStyleId(null);
  };

  const handleBackToWine = () => {
    setEditorActiveTastingId(null);
  };

  const handleOpenTasting = (wineId, tastingId) => {
    setEditorMode('wines');
    setEditorSelectedWineId(wineId);
    setEditorActiveTastingId(tastingId);
  };

  const handleWineFieldChange = (wineId, field, value) => {
    setEditorWines((currentWines) =>
      currentWines.map((wine) => (
        wine.id === wineId ? { ...wine, [field]: value } : wine
      ))
    );
  };

  const handleStyleFieldChange = (styleId, field, value) => {
    setEditorWineStyles((currentStyles) =>
      currentStyles.map((wineStyle) => (
        wineStyle.id === styleId ? { ...wineStyle, [field]: value } : wineStyle
      ))
    );
  };

  const handleTastingFieldChange = (wineId, tastingId, field, value) => {
    setEditorWines((currentWines) =>
      currentWines.map((wine) => {
        if (wine.id !== wineId) {
          return wine;
        }

        return {
          ...wine,
          tastings: wine.tastings.map((tasting) => {
            if (tasting.id !== tastingId) {
              return tasting;
            }

            if (field === 'imagesText') {
              return {
                ...tasting,
                imagesText: value,
                images: parseImageText(value)
              };
            }

            return {
              ...tasting,
              [field]: value
            };
          })
        };
      })
    );
  };

  const handleAddWine = async () => {
    if (!selectedRegion || !editorDraftName.trim()) {
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(`/api/regions/${selectedRegion.slug}/wines`, {
        name: editorDraftName.trim(),
        notes: '',
        styleId: null
      });
      setEditorDraftName('');
      const nextWine = normalizeEditorWine(response.data.wine);
      setEditorWines((currentWines) => [
        nextWine,
        ...currentWines
      ]);
      setEditorSelectedWineId(nextWine.id);
      setEditorActiveTastingId(null);
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not add this wine.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleAddWineStyle = async () => {
    if (!selectedRegion || !editorStyleDraftName.trim()) {
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(`/api/regions/${selectedRegion.slug}/wine-styles`, {
        name: editorStyleDraftName.trim(),
        notes: ''
      });
      setEditorStyleDraftName('');
      const nextStyle = normalizeEditorWineStyle(response.data.wineStyle);
      setEditorWineStyles((currentStyles) => [nextStyle, ...currentStyles]);
      setEditorMode('styles');
      setEditorSelectedStyleId(nextStyle.id);
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not add this wine style.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleUpdateWine = useCallback(async (wineId) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);

    if (!wine?.name.trim()) {
      setEditorError('Wine name cannot be empty.');
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.put(`/api/regions/${selectedRegion.slug}/wines/${wineId}`, {
        name: wine.name.trim(),
        notes: wine.notes || '',
        imageUrl: wine.imageUrl || '',
        styleId: wine.styleId || null
      });
      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId ? normalizeEditorWine(response.data.wine) : entry
        ))
      );
      setEditorSelectedWineId(wineId);
      wineAutosaveSnapshotRef.current[wineId] = JSON.stringify({
        name: wine.name.trim(),
        notes: wine.notes || '',
        imageUrl: wine.imageUrl || '',
        styleId: wine.styleId || ''
      });
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not save this wine.');
    } finally {
      setEditorSaving(false);
    }
  }, [editorWines, loadRegions, selectedRegion]);

  const handleGenerateWineNotes = async (wineId) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);

    if (!wine?.name.trim()) {
      setEditorError('Wine name cannot be empty.');
      return;
    }

    try {
      setEditorGeneratingWineId(wineId);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(
        `/api/regions/${selectedRegion.slug}/wines/${wineId}/generate-notes`
      );
      const nextNotes = String(response.data?.notes || '').trim();

      if (!nextNotes) {
        setEditorError('AI did not return any notes for this wine.');
        return;
      }

      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId
            ? { ...entry, notes: nextNotes }
            : entry
        ))
      );
      setEditorSelectedWineId(wineId);
    } catch (requestError) {
      setEditorError(
        requestError.response?.data?.error || 'Could not generate notes for this wine.'
      );
    } finally {
      setEditorGeneratingWineId('');
    }
  };

  const handleUpdateWineStyle = useCallback(async (styleId) => {
    if (!selectedRegion) {
      return;
    }

    const wineStyle = editorWineStyles.find((entry) => entry.id === styleId);

    if (!wineStyle?.name.trim()) {
      setEditorError('Wine style name cannot be empty.');
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.put(`/api/regions/${selectedRegion.slug}/wine-styles/${styleId}`, {
        name: wineStyle.name.trim(),
        notes: wineStyle.notes || ''
      });
      setEditorWineStyles((currentStyles) =>
        currentStyles.map((entry) => (
          entry.id === styleId ? normalizeEditorWineStyle(response.data.wineStyle) : entry
        ))
      );
      setEditorSelectedStyleId(styleId);
      wineStyleAutosaveSnapshotRef.current[styleId] = JSON.stringify({
        name: wineStyle.name.trim(),
        notes: wineStyle.notes || ''
      });
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not save this wine style.');
    } finally {
      setEditorSaving(false);
    }
  }, [editorWineStyles, loadRegions, selectedRegion]);

  const handleGenerateStyleNotes = async (styleId) => {
    if (!selectedRegion) {
      return;
    }

    const wineStyle = editorWineStyles.find((entry) => entry.id === styleId);

    if (!wineStyle?.name.trim()) {
      setEditorError('Wine style name cannot be empty.');
      return;
    }

    try {
      setEditorGeneratingStyleId(styleId);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(
        `/api/regions/${selectedRegion.slug}/wine-styles/${styleId}/generate-notes`
      );
      const nextNotes = String(response.data?.notes || '').trim();

      if (!nextNotes) {
        setEditorError('AI did not return any notes for this wine style.');
        return;
      }

      setEditorWineStyles((currentStyles) =>
        currentStyles.map((entry) => (
          entry.id === styleId
            ? { ...entry, notes: nextNotes }
            : entry
        ))
      );
      setEditorSelectedStyleId(styleId);
    } catch (requestError) {
      setEditorError(
        requestError.response?.data?.error || 'Could not generate notes for this wine style.'
      );
    } finally {
      setEditorGeneratingStyleId('');
    }
  };

  const handleFindStyleExamples = async (styleId) => {
    if (!selectedRegion) {
      return;
    }

    const wineStyle = editorWineStyles.find((entry) => entry.id === styleId);

    if (!wineStyle?.name.trim()) {
      setEditorError('Wine style name cannot be empty.');
      return;
    }

    try {
      setEditorFindingStyleExamplesId(styleId);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(
        `/api/regions/${selectedRegion.slug}/wine-styles/${styleId}/find-examples`
      );
      const createdWines = Array.isArray(response.data?.createdWines) ? response.data.createdWines : [];
      const summary = String(response.data?.summary || '').trim();

      await loadEditorData(selectedRegion.slug);
      setEditorMode('styles');
      setEditorSelectedStyleId(styleId);

      if (createdWines.length) {
        setEditorNotice(
          `${createdWines.length} example${createdWines.length === 1 ? '' : 's'} added.${summary ? ` ${summary}` : ''}`
        );
      } else {
        setEditorNotice(summary || 'No suitable UK examples were found for this wine style.');
      }
    } catch (requestError) {
      setEditorError(
        requestError.response?.data?.error || 'Could not find examples for this wine style.'
      );
    } finally {
      setEditorFindingStyleExamplesId('');
    }
  };

  const handleDeleteWine = async (wineId) => {
    if (!selectedRegion) {
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      await axios.delete(`/api/regions/${selectedRegion.slug}/wines/${wineId}`);
      setEditorWines((currentWines) => currentWines.filter((wine) => wine.id !== wineId));
      if (editorSelectedWineId === wineId) {
        setEditorSelectedWineId(null);
        setEditorActiveTastingId(null);
      }
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not delete this wine.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleDeleteWineStyle = async (styleId) => {
    if (!selectedRegion) {
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      await axios.delete(`/api/regions/${selectedRegion.slug}/wine-styles/${styleId}`);
      setEditorWineStyles((currentStyles) => currentStyles.filter((wineStyle) => wineStyle.id !== styleId));
      setEditorWines((currentWines) =>
        currentWines.map((wine) => (
          wine.styleId === styleId
            ? { ...wine, styleId: '', styleName: '' }
            : wine
        ))
      );
      if (editorSelectedStyleId === styleId) {
        setEditorSelectedStyleId(null);
      }
      await loadRegions();
    } catch (requestError) {
      setEditorError('Could not delete this wine style.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleUpdateTasting = useCallback(async (wineId, tastingId) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);
    const tasting = wine?.tastings.find((entry) => entry.id === tastingId);

    if (!wine || !tasting) {
      return;
    }

    const payload = {
      date: tasting.date || null,
      rating: tasting.rating || 0,
      price: tasting.price || '',
      notes: tasting.notes || '',
      images: parseImageText(tasting.imagesText)
    };

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = tasting.isNew
        ? await axios.post(`/api/regions/${selectedRegion.slug}/wines/${wineId}/tastings`, payload)
        : await axios.put(
            `/api/regions/${selectedRegion.slug}/wines/${wineId}/tastings/${tastingId}`,
            payload
          );
      const normalizedWine = normalizeEditorWine(response.data.wine);
      const matchingTasting = normalizedWine.tastings.find((entry) => (
        (entry.date || '') === (payload.date || '') &&
        (entry.rating || 0) === payload.rating &&
        (entry.price || '') === payload.price &&
        (entry.notes || '') === payload.notes &&
        JSON.stringify(entry.images || []) === JSON.stringify(payload.images)
      ));
      const nextTastingId = tasting.isNew
        ? (matchingTasting?.id || normalizedWine.tastings[0]?.id || null)
        : tastingId;

      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId ? normalizedWine : entry
        ))
      );
      setEditorSelectedWineId(wineId);
      setEditorActiveTastingId(nextTastingId);
      tastingAutosaveSnapshotRef.current[nextTastingId || tastingId] = JSON.stringify(payload);
      if (nextTastingId && nextTastingId !== tastingId) {
        delete tastingAutosaveSnapshotRef.current[tastingId];
      }
    } catch (requestError) {
      setEditorError('Could not save this tasting.');
    } finally {
      setEditorSaving(false);
    }
  }, [editorWines, selectedRegion]);

  const handleDeleteTasting = async (wineId, tastingId) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);
    const tasting = wine?.tastings.find((entry) => entry.id === tastingId);

    if (!tasting) {
      return;
    }

    if (tasting.isNew) {
      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId
            ? { ...entry, tastings: entry.tastings.filter((item) => item.id !== tastingId) }
            : entry
        ))
      );
      setEditorActiveTastingId(null);
      return;
    }

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.delete(
        `/api/regions/${selectedRegion.slug}/wines/${wineId}/tastings/${tastingId}`
      );

      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId ? normalizeEditorWine(response.data.wine) : entry
        ))
      );
      setEditorSelectedWineId(wineId);
      setEditorActiveTastingId(null);
    } catch (requestError) {
      setEditorError('Could not delete this tasting.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleUploadTastingImages = async (wineId, tastingId, files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post('/api/uploads/images', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const uploadedUrls = (response.data.images || []).map((image) => image.url).filter(Boolean);

      setEditorWines((currentWines) =>
        currentWines.map((wine) => {
          if (wine.id !== wineId) {
            return wine;
          }

          return {
            ...wine,
            tastings: wine.tastings.map((tasting) => {
              if (tasting.id !== tastingId) {
                return tasting;
              }

              const nextImages = [...tasting.images, ...uploadedUrls];
              return {
                ...tasting,
                images: nextImages,
                imagesText: nextImages.join('\n')
              };
            })
          };
        })
      );
    } catch (requestError) {
      setEditorError('Could not upload these images.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleUploadWineImage = async (wineId, file) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);

    if (!wine) {
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      setEditorSaving(true);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post('/api/uploads/wine-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const uploadedUrl = response.data?.image?.url || '';
      const updateResponse = await axios.put(`/api/regions/${selectedRegion.slug}/wines/${wineId}`, {
        name: wine.name.trim(),
        notes: wine.notes || '',
        imageUrl: uploadedUrl,
        styleId: wine.styleId || null
      });
      const normalizedWine = normalizeEditorWine(updateResponse.data.wine);

      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId ? normalizedWine : entry
        ))
      );
      wineAutosaveSnapshotRef.current[wineId] = JSON.stringify({
        name: normalizedWine.name.trim(),
        notes: normalizedWine.notes || '',
        imageUrl: normalizedWine.imageUrl || '',
        styleId: normalizedWine.styleId || ''
      });
    } catch (requestError) {
      setEditorError('Could not upload this wine image.');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleGenerateWineImage = async (wineId) => {
    if (!selectedRegion) {
      return;
    }

    const wine = editorWines.find((entry) => entry.id === wineId);

    if (!wine?.name.trim()) {
      setEditorError('Wine name cannot be empty.');
      return;
    }

    try {
      setEditorGeneratingWineImageId(wineId);
      setEditorError('');
      setEditorNotice('');
      const response = await axios.post(
        `/api/regions/${selectedRegion.slug}/wines/${wineId}/generate-image`
      );
      const normalizedWine = normalizeEditorWine(response.data.wine);

      setEditorWines((currentWines) =>
        currentWines.map((entry) => (
          entry.id === wineId ? normalizedWine : entry
        ))
      );
      setEditorSelectedWineId(wineId);
      wineAutosaveSnapshotRef.current[wineId] = JSON.stringify({
        name: normalizedWine.name.trim(),
        notes: normalizedWine.notes || '',
        imageUrl: normalizedWine.imageUrl || '',
        styleId: normalizedWine.styleId || ''
      });
    } catch (requestError) {
      setEditorError(
        requestError.response?.data?.error || 'Could not generate a wine image.'
      );
    } finally {
      setEditorGeneratingWineImageId('');
    }
  };

  const handleStartNewTasting = (wineId) => {
    const draft = normalizeEditorTasting({ isNew: true, images: [] });

    setEditorWines((currentWines) =>
      currentWines.map((wine) => (
        wine.id === wineId
          ? { ...wine, tastings: [draft, ...wine.tastings] }
          : wine
      ))
    );
    setEditorSelectedWineId(wineId);
    setEditorActiveTastingId(draft.id);
  };

  useEffect(() => {
    if (wineAutosaveTimerRef.current) {
      window.clearTimeout(wineAutosaveTimerRef.current);
      wineAutosaveTimerRef.current = null;
    }

    if (!selectedEditorWine || selectedEditorTasting) {
      return undefined;
    }

    const payload = {
      name: selectedEditorWine.name.trim(),
      notes: selectedEditorWine.notes || '',
      imageUrl: selectedEditorWine.imageUrl || '',
      styleId: selectedEditorWine.styleId || ''
    };
    const snapshot = JSON.stringify(payload);

    if (!payload.name) {
      return undefined;
    }

    if (wineAutosaveSnapshotRef.current[selectedEditorWine.id] === snapshot) {
      return undefined;
    }

    wineAutosaveTimerRef.current = window.setTimeout(() => {
      handleUpdateWine(selectedEditorWine.id);
    }, 700);

    return () => {
      if (wineAutosaveTimerRef.current) {
        window.clearTimeout(wineAutosaveTimerRef.current);
        wineAutosaveTimerRef.current = null;
      }
    };
  }, [handleUpdateWine, selectedEditorTasting, selectedEditorWine]);

  useEffect(() => {
    if (wineStyleAutosaveTimerRef.current) {
      window.clearTimeout(wineStyleAutosaveTimerRef.current);
      wineStyleAutosaveTimerRef.current = null;
    }

    if (!selectedEditorStyle) {
      return undefined;
    }

    const payload = {
      name: selectedEditorStyle.name.trim(),
      notes: selectedEditorStyle.notes || ''
    };
    const snapshot = JSON.stringify(payload);

    if (!payload.name) {
      return undefined;
    }

    if (wineStyleAutosaveSnapshotRef.current[selectedEditorStyle.id] === snapshot) {
      return undefined;
    }

    wineStyleAutosaveTimerRef.current = window.setTimeout(() => {
      handleUpdateWineStyle(selectedEditorStyle.id);
    }, 700);

    return () => {
      if (wineStyleAutosaveTimerRef.current) {
        window.clearTimeout(wineStyleAutosaveTimerRef.current);
        wineStyleAutosaveTimerRef.current = null;
      }
    };
  }, [handleUpdateWineStyle, selectedEditorStyle]);

  useEffect(() => {
    if (tastingAutosaveTimerRef.current) {
      window.clearTimeout(tastingAutosaveTimerRef.current);
      tastingAutosaveTimerRef.current = null;
    }

    if (!selectedRegion || !selectedEditorWine || !selectedEditorTasting) {
      return undefined;
    }

    const payload = {
      date: selectedEditorTasting.date || null,
      rating: selectedEditorTasting.rating || 0,
      price: selectedEditorTasting.price || '',
      notes: selectedEditorTasting.notes || '',
      images: parseImageText(selectedEditorTasting.imagesText)
    };
    const snapshot = JSON.stringify(payload);
    const hasContent = Boolean(
      payload.date ||
      payload.price.trim() ||
      payload.notes.trim() ||
      payload.images.length
    );

    if (!hasContent) {
      return undefined;
    }

    if (tastingAutosaveSnapshotRef.current[selectedEditorTasting.id] === snapshot) {
      return undefined;
    }

    tastingAutosaveTimerRef.current = window.setTimeout(() => {
      handleUpdateTasting(selectedEditorWine.id, selectedEditorTasting.id);
    }, 700);

    return () => {
      if (tastingAutosaveTimerRef.current) {
        window.clearTimeout(tastingAutosaveTimerRef.current);
        tastingAutosaveTimerRef.current = null;
      }
    };
  }, [handleUpdateTasting, selectedEditorTasting, selectedEditorWine, selectedRegion]);

  return (
    <div className={`app-shell ${!isMapVisible || isWorldHome ? 'app-shell--world' : ''}`}>
      <button
        type="button"
        className="fast-add-fab"
        onClick={handleOpenFastAdd}
        aria-label="Fast add from photo"
        title="Fast Add from Photo"
      >
        <span className="fast-add-fab__icon" aria-hidden="true">+</span>
        <span className="fast-add-fab__label">Fast Add</span>
      </button>

      <FastAddModal
        isOpen={isFastAddOpen}
        draft={fastAddDraft}
        regionOptions={fastAddRegionOptions}
        wineStyleOptions={fastAddWineStyleOptions}
        busy={fastAddBusy}
        error={fastAddError}
        stage={fastAddStage}
        onClose={handleCloseFastAdd}
        onAnalyze={handleAnalyzeFastAdd}
        onFieldChange={handleFastAddFieldChange}
        onRegionChange={handleFastAddRegionChange}
        onCreate={handleCreateFastAdd}
      />

      <AddRegionModal
        isOpen={isAddRegionOpen}
        busy={addRegionBusy}
        error={addRegionError}
        country={addRegionCountry}
        name={addRegionName}
        onClose={handleCloseAddRegion}
        onCountryChange={setAddRegionCountry}
        onNameChange={setAddRegionName}
        onCreate={handleCreateRegion}
      />

      {!isWorldHome && isMapVisible && (
      <aside className="sidebar">
        {selectedRegion ? (
          <>
            <div className="sidebar__hero">
              <div className="sidebar-breadcrumbs">
                <button type="button" className="crumb-button" onClick={handleBackToCountry}>
                  {country}
                </button>
                <span className="crumb-separator">/</span>
                <span className="crumb-current">{selectedRegion.name}</span>
              </div>
              <h1>{selectedRegion.name}</h1>
              <p className="lede">{selectedRegion.description}</p>
            </div>

            <div className="country-summary-card">
              <p className="eyebrow">Climate</p>
              <strong>{selectedRegion.climate}</strong>
            </div>

            <div className="sidebar-detail-grid">
              <section className="sidebar-detail-card">
                <h3>Region Notes</h3>
                <ul>
                  {selectedRegion.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </section>
              <section
                className="sidebar-detail-card sidebar-detail-card--link"
                role="button"
                tabIndex={0}
                onClick={() => handleOpenWineStyleEditor()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenWineStyleEditor();
                  }
                }}
              >
                <h3>Wine Styles</h3>
                <RegionTags items={selectedRegion.wineStyles} onItemClick={handleOpenWineStyleEditor} />
              </section>
              <section
                className="sidebar-detail-card sidebar-detail-card--link"
                role="button"
                tabIndex={0}
                onClick={() => handleOpenWineEditor()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenWineEditor();
                  }
                }}
              >
                <h3>Wines</h3>
                <RegionTags items={selectedRegion.wines} onItemClick={handleOpenWineEditor} />
              </section>
              <section className="sidebar-detail-card">
                <h3>Key Grapes</h3>
                <RegionTags items={selectedRegion.grapes} />
              </section>
            </div>
          </>
        ) : (
          <>
            <div className="sidebar__hero">
              <p className="eyebrow">Global Wine Atlas</p>
              <h1>{country}</h1>
              <button type="button" className="secondary-button sidebar__hero-action" onClick={handleOpenAddRegion}>
                Add Region
              </button>
            </div>

            <div className="region-list">
              {loading && <div className="state-card">Loading the atlas…</div>}
              {!loading && error && <div className="state-card state-card--error">{error}</div>}
              {!loading && !error && !regions.length && (
                <div className="state-card">No regions found for this country.</div>
              )}
              {!loading &&
                !error &&
                regions.map((region) => (
                  <button
                    key={region.slug}
                    type="button"
                    className={`region-card ${selectedRegion?.slug === region.slug ? 'is-active' : ''}`}
                    onClick={() => setSelectedSlug(region.slug)}
                  >
                    <div className="region-card__topline">
                      <strong>{region.name}</strong>
                      <span>{region.climate}</span>
                    </div>
                    <p>{region.description}</p>
                    <RegionTags items={region.wineStyles.slice(0, 2)} />
                  </button>
                ))}
            </div>
          </>
        )}
      </aside>
      )}

      <main className={`map-stage ${isEditingWines ? 'map-stage--editor' : ''}`}>
        <div className={`map-frame ${isEditingWines ? 'map-frame--hidden' : ''}`}>
          <div ref={mapNodeRef} className="map-canvas" />
          <button
            type="button"
            className="map-home-button"
            onClick={handleGoHome}
            aria-label="Return to world view"
            title="Home"
          >
            <span className="map-home-button__icon" aria-hidden="true">🌐</span>
          </button>
        </div>

        {isEditingWines && selectedRegion && (
          <WineEditor
            region={selectedRegion}
            onBackToCountry={handleBackToCountry}
            mode={editorMode}
            wines={editorWines}
            wineStyles={editorWineStyles}
            selectedWine={selectedEditorWine}
            selectedStyle={selectedEditorStyle}
            activeTasting={selectedEditorTasting}
            draftName={editorDraftName}
            draftStyleName={editorStyleDraftName}
            loading={editorLoading}
            saving={editorSaving}
            error={editorError}
            notice={editorNotice}
            generatingWineNotesId={editorGeneratingWineId}
            generatingWineImageId={editorGeneratingWineImageId}
            generatingStyleNotesId={editorGeneratingStyleId}
            findingStyleExamplesId={editorFindingStyleExamplesId}
            onDraftChange={setEditorDraftName}
            onDraftStyleChange={setEditorStyleDraftName}
            onAddWine={handleAddWine}
            onAddWineStyle={handleAddWineStyle}
            onDeleteWine={handleDeleteWine}
            onDeleteWineStyle={handleDeleteWineStyle}
            onSelectWine={handleSelectWine}
            onSelectStyle={handleSelectStyle}
            onBackToWineList={handleBackToWineList}
            onBackToStyleList={handleBackToStyleList}
            onOpenTasting={handleOpenTasting}
            onStartNewTasting={handleStartNewTasting}
            onBackToWine={handleBackToWine}
            onDeleteTasting={handleDeleteTasting}
            onSetMode={setEditorMode}
            onWineFieldChange={handleWineFieldChange}
            onGenerateWineNotes={handleGenerateWineNotes}
            onStyleFieldChange={handleStyleFieldChange}
            onGenerateStyleNotes={handleGenerateStyleNotes}
            onFindStyleExamples={handleFindStyleExamples}
            onTastingFieldChange={handleTastingFieldChange}
            onUploadTastingImages={handleUploadTastingImages}
            onUploadWineImage={handleUploadWineImage}
            onGenerateWineImage={handleGenerateWineImage}
            onClose={handleCloseWineEditor}
          />
        )}
      </main>
    </div>
  );
}

export default App;
